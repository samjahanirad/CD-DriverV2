// CD Metadata
const CD_ID = "youtube-thumbnail";
const CD_NAME = "YouTube Thumbnail Downloader";
const CD_VERSION = "1.0.0";
const CD_DESCRIPTION = "Downloads the max-resolution thumbnail of the current YouTube video.";

// Runs in page context. Must return a plain serializable object.
function getData() {
  const match = window.location.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (!match) {
    throw new Error("Not a YouTube video page — navigate to a video first.");
  }
  const videoId = match[1];
  const title = document.title.replace(" - YouTube", "").trim();
  return {
    videoId,
    title,
    url: window.location.href,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
  };
}

// Runs in page context. Return { action, ...params } for privileged actions,
// or a plain result object for display-only outcomes.
function runCD(data) {
  return {
    action: "download",
    url: data.thumbnailUrl,
    filename: `${data.videoId}-thumbnail.jpg`
  };
}
