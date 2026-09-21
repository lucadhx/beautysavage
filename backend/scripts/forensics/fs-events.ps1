# ══ SECONDE SOURCE D'ÉVÉNEMENTS FICHIER — INDÉPENDANTE DE `fs.watch` ═══════
#
# ── POURQUOI UNE SECONDE SOURCE ────────────────────────────────────────────
#
# Le V2 a rapporte `filesChanged=0` alors que le surveillant de Node avait bel
# et bien redemarre. Une seule source d'evenements ne permet pas de trancher
# entre « rien ne s'est passe » et « notre source n'a rien vu » — or ces deux
# conclusions appellent des actions opposees.
#
# `System.IO.FileSystemWatcher` est l'API .NET posee directement sur
# ReadDirectoryChangesW. Elle ne partage aucun code avec libuv, donc aucun de
# ses angles morts. Mesure : elle voit un remplacement atomique comme
# « Created .tmp » + « Deleted original », la ou `fs.watch` ne signale qu'un
# « rename » — deux lectures d'un meme fait, et c'est exactement ce qu'on veut.
#
# ── CE QU'IL N'EMET JAMAIS ─────────────────────────────────────────────────
#
# Aucun contenu de fichier. Un chemin, un type d'evenement, un horodatage : de
# quoi attribuer un redemarrage, jamais de quoi divulguer un secret.
#
# ── CYCLE DE VIE ───────────────────────────────────────────────────────────
#
# Lance AUTOMATIQUEMENT par `dev-watch.js`, il meurt avec lui : la boucle
# s'arrete des que l'entree standard se ferme, ce qui arrive quand le lanceur
# disparait — y compris s'il est tue brutalement.
#
# ── CYCLE DE VIE, ET POURQUOI PAS L'ENTRÉE STANDARD ────────────────────────
#
# La tentation etait de detecter le depart du lanceur par un EOF sur stdin.
# `[Console]::In.Peek()` BLOQUE sur un tuyau ouvert mais vide : la boucle
# d'evenements se figeait des le premier tour, et le helper se taisait sans
# jamais dire pourquoi. On surveille donc le PID du parent, ce qui ne bloque
# rien et couvre aussi le cas ou il est tue brutalement.
#
# ── POURQUOI UNE CHAÎNE, ET NON UN TABLEAU DE PARAMÈTRES ───────────────────
#
# MESURE : appele via `-File`, PowerShell ne lie QU'UNE valeur a un parametre
# `[string[]]` ; la racine suivante devient un argument positionnel orphelin et
# le script meurt avec « Impossible de trouver un parametre positionnel ». On
# passe donc UNE chaine, separee par `|` — caractere INTERDIT dans un chemin
# Windows, donc sans ambiguite possible, y compris pour les chemins contenant
# des espaces (celui de ce projet en contient).
param(
  [Parameter(Mandatory = $true)][string]$RootsJoined,
  [int]$ParentPid = 0
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
$Roots = $RootsJoined.Split('|') | Where-Object { $_ -ne '' }

# `Register-ObjectEvent` MET EN FILE. C'est la difference qui compte avec
# `WaitForChanged`, qui ne regarde que pendant qu'on l'appelle et perd tout ce
# qui arrive entre deux appels — precisement les rafales qu'on cherche.
$watchers = @()
$i = 0
foreach ($root in $Roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  try {
    $w = New-Object System.IO.FileSystemWatcher
    $w.Path = $root
    $w.IncludeSubdirectories = $true
    $w.InternalBufferSize = 65536   # rafales : un tampon trop petit PERD des evenements
    $w.NotifyFilter = [System.IO.NotifyFilters]::LastWrite `
      -bor [System.IO.NotifyFilters]::FileName `
      -bor [System.IO.NotifyFilters]::Size `
      -bor [System.IO.NotifyFilters]::CreationTime
    $w.EnableRaisingEvents = $true
    foreach ($evt in 'Changed', 'Created', 'Deleted', 'Renamed') {
      Register-ObjectEvent -InputObject $w -EventName $evt -SourceIdentifier "fsw$i-$evt" | Out-Null
    }
    $watchers += $w
    $i++
    Write-Output ("READY|{0}" -f $root)
  } catch {
    Write-Output ("ERROR|{0}|{1}" -f $root, $_.Exception.Message)
  }
}

if ($watchers.Count -eq 0) { Write-Output 'ERROR|aucune racine surveillable'; exit 1 }
Write-Output ("STARTED|{0}" -f $watchers.Count)

# Le debordement du tampon doit etre DIT, jamais tu : un rapport qui ignore
# « j'ai perdu des evenements » ferait passer une lacune pour une absence.
foreach ($w in $watchers) {
  Register-ObjectEvent -InputObject $w -EventName Error -SourceIdentifier ("fswerr" + [guid]::NewGuid().ToString('N')) | Out-Null
}

$prochainControle = (Get-Date).AddSeconds(2)
while ($true) {
  if ((Get-Date) -ge $prochainControle) {
    $prochainControle = (Get-Date).AddSeconds(2)
    if ($ParentPid -gt 0) {
      $vivant = $null -ne (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)
      if (-not $vivant) { break }
    }
  }
  $e = Wait-Event -Timeout 2
  if ($null -ne $e) {
    $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $args_ = $e.SourceEventArgs
    if ($args_ -is [System.IO.ErrorEventArgs]) {
      Write-Output ("OVERFLOW|{0}" -f $ms)
    } else {
      $type = $args_.ChangeType
      $full = $args_.FullPath
      Write-Output ("EVENT|{0}|{1}|{2}" -f $ms, $type, $full)
      if ($args_ -is [System.IO.RenamedEventArgs]) {
        Write-Output ("EVENT|{0}|RenamedFrom|{1}" -f $ms, $args_.OldFullPath)
      }
    }
    Remove-Event -EventIdentifier $e.EventIdentifier
  }
}
