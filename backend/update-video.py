from pathlib import Path 
path = Path('public/js/modules/myFormationModuleDetailModule.js') 
text = path.read_text(encoding='utf-8') 
start = text.index('function buildYoutubeEmbedUrl') 
end = text.index('function renderFilesSection') 
new_block = '''function getEmbeddableUrl(value) { 
  if (!value) return null; 
  try { 
    const url = new URL(value); 
      return url.href; 
    } 
  } catch (error) { 
    console.error('URL parsing failed', error); 
  } 
  return null; 
} 
 
function renderVideosSection(videos) { 
  const validVideos = 
    Array.isArray(videos) && videos.length 
      ? videos 
          .map(video = embedUrl: getEmbeddableUrl(video) })) 
          .filter(entry =
      : []; 
 
  if (!validVideos.length) { 
    return '<p class=\" "module-placeholder\ vid‚o disponible.</p
function getEmbeddableUrl(value) { 
