# ══ QUI A LANCÉ UN GESTIONNAIRE DE PAQUETS PENDANT LA FENÊTRE ? ════════════
#
# ── LA QUESTION À LAQUELLE CE HELPER RÉPOND ────────────────────────────────
#
# Le V2 a etabli que 879 fichiers de `node_modules` sont charges, donc capables
# de relancer le service. La question devient : QUI pourrait les reecrire
# pendant que l'application tourne ? `npm install`, `npm ci`, un postinstall,
# une extension d'IDE, un antivirus, un assistant de code.
#
# On ne peut pas prouver l'ecrivain depuis un journal de fichiers. On peut en
# revanche constater qu'un `npm.exe` est ne a 16:17:20.7 — trois dixiemes avant
# le redemarrage. Ce n'est pas une preuve, c'est le chainon qui permet d'aller
# la chercher.
#
# ── POURQUOI UN SONDAGE, ET NON UNE TRACE D'ÉVÉNEMENTS ─────────────────────
#
# MESURE : `Win32_ProcessStartTrace` (la trace evenementielle, exacte) exige
# l'elevation — « Acces refuse » sur ce poste. `Get-CimInstance Win32_Process`
# fonctionne SANS privilege. On sonde donc, et l'on assume la limite : un
# process qui vit moins que l'intervalle peut passer entre deux mailles. C'est
# ecrit ici plutot que decouvert plus tard.
#
# ── CE QU'IL N'EMET JAMAIS ─────────────────────────────────────────────────
#
# Les ARGUMENTS sont caviardes sans exception. Une ligne de commande porte des
# chemins, des jetons de registre, parfois un mot de passe. Le nom de
# l'executable suffit a repondre a la question posee.
param(
  [int]$IntervalMs = 400,
  [int]$ParentPid = 0,
  # ── LA LISTE DES SUSPECTS (§5) ───────────────────────────────────────────
  #
  # Elle ne se limite plus aux gestionnaires de paquets. L'incident `ssh2` a
  # montre un fichier TOUCHE sans aucun npm dans la fenetre : les candidats
  # restants sont les outils qui LISENT ou SCANNENT en permanence — antivirus,
  # synchronisation, indexeur, editeur. Les inventorier ne les accuse pas ; cela
  # permet de dire « aucun d'eux n'etait la », qui est une conclusion utile.
  [string[]]$Names = @(
    'npm.exe', 'npm-cli.js', 'node.exe', 'git.exe', 'pnpm.exe', 'yarn.exe', 'npx.exe',
    'Code.exe', 'MsMpEng.exe', 'MpCmdRun.exe', 'OneDrive.exe', 'Dropbox.exe',
    'GoogleDriveFS.exe', 'SearchIndexer.exe', 'SearchProtocolHost.exe', 'FileCoAuth.exe'
  )
)

$ErrorActionPreference = 'Continue'
$OutputEncoding = [System.Text.Encoding]::UTF8

$filtre = ($Names | ForEach-Object { "Name='$_'" }) -join ' or '
$connus = @{}

# Premier passage : on MEMORISE sans emettre. Les process deja la ne sont pas
# des naissances, et les annoncer noierait la seule information utile.
foreach ($p in (Get-CimInstance Win32_Process -Filter $filtre -ErrorAction SilentlyContinue)) {
  $connus[$p.ProcessId] = $true
}
Write-Output ("READY|{0}" -f $connus.Count)

while ($true) {
  Start-Sleep -Milliseconds $IntervalMs
  $vus = @{}
  foreach ($p in (Get-CimInstance Win32_Process -Filter $filtre -ErrorAction SilentlyContinue)) {
    $vus[$p.ProcessId] = $true
    if (-not $connus.ContainsKey($p.ProcessId)) {
      $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      # Nom + parent + naissance uniquement. JAMAIS la ligne de commande.
      $ct = ''
      try { if ($p.CreationDate) { $ct = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } } catch { $ct = '' }
      Write-Output ("PROC|{0}|{1}|{2}|{3}|{4}" -f $ms, $p.ProcessId, $p.ParentProcessId, $p.Name, $ct)
      $connus[$p.ProcessId] = $true
    }
  }
  foreach ($pid_ in @($connus.Keys)) { if (-not $vus.ContainsKey($pid_)) { $connus.Remove($pid_) } }
  # Meme raison que dans `fs-events.ps1` : on suit le PID du parent, jamais
  # l'entree standard, dont la lecture bloque sur un tuyau ouvert et vide.
  if ($ParentPid -gt 0 -and $null -eq (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
}
