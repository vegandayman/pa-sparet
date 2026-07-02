// host-media.js
// YouTube IFrame Player API wrapper for the host view.
// Handles loading the API, creating players for the two video containers
// (Where Are We Going and Music Round), and exposing simple play/pause/stop
// controls so host.js never touches the YT API directly.

let ytApiReady = false;
let ytApiCallbacks = [];

// Called by the YouTube IFrame API script once it has loaded.
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  ytApiCallbacks.forEach(fn => fn());
  ytApiCallbacks = [];
};

function onYTReady(fn) {
  if (ytApiReady) { fn(); return; }
  ytApiCallbacks.push(fn);
}

// Inject the YouTube IFrame API script once.
(function loadYTScript() {
  if (document.getElementById("yt-iframe-api")) return;
  const tag = document.createElement("script");
  tag.id = "yt-iframe-api";
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
})();

// Registry of created players keyed by container element id.
const players = {};

/**
 * Creates (or recreates) a YouTube player in the given container element.
 * @param {string} containerId - id of the div to replace with the iframe
 * @param {string} videoUrl    - full YouTube URL or video ID
 * @param {Object} opts        - { autoplay, mute, onReady, onStateChange }
 * @returns {Promise<YT.Player>}
 */
function createPlayer(containerId, videoUrl, opts = {}) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return Promise.reject(new Error("Invalid YouTube URL: " + videoUrl));

  // Destroy any existing player in this container.
  if (players[containerId]) {
    try { players[containerId].destroy(); } catch (e) { /* ignore */ }
    delete players[containerId];
  }

  return new Promise((resolve, reject) => {
    onYTReady(() => {
      try {
        const player = new YT.Player(containerId, {
          videoId,
          playerVars: {
            autoplay: opts.autoplay ? 1 : 0,
            mute: opts.mute ? 1 : 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            fs: 0,
          },
          events: {
            onReady: (e) => {
              players[containerId] = player;
              if (opts.onReady) opts.onReady(e);
              resolve(player);
            },
            onStateChange: (e) => {
              if (opts.onStateChange) opts.onStateChange(e);
            },
            onError: (e) => reject(new Error("YouTube player error: " + e.data)),
          },
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

function extractVideoId(url) {
  if (!url) return null;
  // Already a bare video ID (11 chars, no slashes)
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  const match = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

function play(containerId) {
  players[containerId]?.playVideo();
}

function pause(containerId) {
  players[containerId]?.pauseVideo();
}

function stop(containerId) {
  players[containerId]?.stopVideo();
}

function seek(containerId, seconds) {
  players[containerId]?.seekTo(seconds, true);
}

function destroyAll() {
  Object.keys(players).forEach(id => {
    try { players[id].destroy(); } catch (e) { /* ignore */ }
    delete players[id];
  });
}

export { createPlayer, play, pause, stop, seek, destroyAll, extractVideoId };
