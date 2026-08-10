// host-media.js
let ytApiReady = false, ytApiCallbacks = [];
window.onYouTubeIframeAPIReady = function() { ytApiReady = true; ytApiCallbacks.forEach(fn => fn()); ytApiCallbacks = []; };
function onYTReady(fn) { if (ytApiReady) { fn(); return; } ytApiCallbacks.push(fn); }
(function() { if (document.getElementById("yt-iframe-api")) return; const tag = document.createElement("script"); tag.id = "yt-iframe-api"; tag.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(tag); })();
const players = {};
function createPlayer(containerId, videoUrl, opts = {}) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return Promise.reject(new Error("Invalid YouTube URL: " + videoUrl));
  if (players[containerId]) { try { players[containerId].destroy(); } catch(e){} delete players[containerId]; }
  return new Promise((resolve, reject) => {
    onYTReady(() => {
      try {
        const player = new YT.Player(containerId, {
          videoId, playerVars: { autoplay: opts.autoplay ? 1 : 0, mute: opts.mute ? 1 : 0, controls: 1, rel: 0, modestbranding: 1, fs: 0 },
          events: {
            onReady: e => { players[containerId] = player; if (opts.onReady) opts.onReady(e); resolve(player); },
            onStateChange: e => { if (opts.onStateChange) opts.onStateChange(e); },
            onError: e => reject(new Error("YouTube player error: " + e.data)),
          },
        });
      } catch(err) { reject(err); }
    });
  });
}
function extractVideoId(url) {
  if (!url) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  const match = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}
function play(id) { players[id]?.playVideo(); }
function pause(id) { players[id]?.pauseVideo(); }
function stop(id) { players[id]?.stopVideo(); }
function destroyAll() { Object.keys(players).forEach(id => { try { players[id].destroy(); } catch(e){} delete players[id]; }); }
export { createPlayer, play, pause, stop, destroyAll, extractVideoId };
