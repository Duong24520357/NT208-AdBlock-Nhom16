
var CAPTURE_MIN_DELAY = 120;
var CAPTURE_MAX_DELAY = 1200;

function isScrollableNode(node) {
    if (!node || node === document.body || node === document.documentElement) {
        return !!node;
    }

    try {
        var style = window.getComputedStyle(node);
        var overflowY = style.overflowY || style.overflow;
        var overflowX = style.overflowX || style.overflow;
        return ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && node.scrollHeight > node.clientHeight + 1) ||
               ((overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') && node.scrollWidth > node.clientWidth + 1);
    } catch (e) {
        return false;
    }
}

function findScrollableAncestor(node) {
    while (node && node !== document.body && node !== document.documentElement) {
        if (isScrollableNode(node)) {
            return node;
        }
        node = node.parentElement;
    }

    return null;
}

function getScrollRoot() {
    var centerNode = null;
    try {
        centerNode = document.elementFromPoint(
            Math.max(0, Math.floor(window.innerWidth / 2)),
            Math.max(0, Math.floor(window.innerHeight / 2))
        );
    } catch (e) {}

    var activeNode = document.activeElement;
    var centerRoot = findScrollableAncestor(centerNode);
    if (centerRoot) {
        return centerRoot;
    }

    var activeRoot = findScrollableAncestor(activeNode);
    if (activeRoot) {
        return activeRoot;
    }

    var candidates = [
        document.scrollingElement,
        document.documentElement,
        document.body,
        document.querySelector('main'),
        document.querySelector('[role="main"]'),
        document.querySelector('#root'),
        document.querySelector('#app')
    ].filter(Boolean);

    var best = document.scrollingElement || document.documentElement || document.body;
    var bestOverflow = -1;

    candidates.forEach(function(node) {
        try {
            var overflow = Math.max(0, (node.scrollHeight || 0) - (node.clientHeight || 0));
            if (overflow > bestOverflow) {
                bestOverflow = overflow;
                best = node;
            }
        } catch (e) {}
    });

    return best;
}

function readScroll(root) {
    if (root && root !== document.documentElement && root !== document.body && root !== document.scrollingElement) {
        return {
            x: root.scrollLeft || 0,
            y: root.scrollTop || 0
        };
    }

    return {
        x: window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0,
        y: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
    };
}

function scrollToPosition(root, x, y) {
    var targetX = Math.max(0, x || 0);
    var targetY = Math.max(0, y || 0);

    try {
        window.scrollTo(targetX, targetY);
    } catch (e) {}

    try {
        window.scrollTo({left: targetX, top: targetY, behavior: 'auto'});
    } catch (e) {}

    try {
        if (document.documentElement) {
            document.documentElement.scrollLeft = targetX;
            document.documentElement.scrollTop = targetY;
        }
    } catch (e) {}

    try {
        if (document.body) {
            document.body.scrollLeft = targetX;
            document.body.scrollTop = targetY;
        }
    } catch (e) {}

    if (root && root !== document.documentElement && root !== document.body && root !== document.scrollingElement) {
        try {
            root.scrollLeft = targetX;
            root.scrollTop = targetY;
        } catch (e) {}
    }
}

function collectCaptureState() {
    var hiddenNodes = [];
    var pausedMedia = [];
    var styleEl = document.createElement('style');

    styleEl.setAttribute('data-capture-helper', 'true');
    styleEl.textContent = [
        '* {',
        '  animation-play-state: paused !important;',
        '  transition-property: none !important;',
        '  transition-duration: 0s !important;',
        '}',
        'video, audio {',
        '  animation: none !important;',
        '}'
    ].join('\n');

    (document.head || document.documentElement || document.body).appendChild(styleEl);

    Array.prototype.slice.call(document.querySelectorAll('*')).forEach(function(node) {
        try {
            var position = window.getComputedStyle(node).position;
            if (position === 'fixed' || position === 'sticky') {
                hiddenNodes.push({
                    node: node,
                    visibility: node.style.visibility,
                    pointerEvents: node.style.pointerEvents
                });
                node.style.visibility = 'hidden';
                node.style.pointerEvents = 'none';
            }
        } catch (e) {}
    });

    Array.prototype.slice.call(document.querySelectorAll('video, audio')).forEach(function(media) {
        try {
            if (!media.paused && !media.ended) {
                pausedMedia.push(media);
                media.pause();
            }
        } catch (e) {}
    });

    return {
        styleEl: styleEl,
        hiddenNodes: hiddenNodes,
        pausedMedia: pausedMedia
    };
}

function restoreCaptureState(state) {
    if (!state) {
        return;
    }

    if (state.styleEl && state.styleEl.parentNode) {
        state.styleEl.parentNode.removeChild(state.styleEl);
    }

    (state.hiddenNodes || []).forEach(function(entry) {
        try {
            entry.node.style.visibility = entry.visibility;
            entry.node.style.pointerEvents = entry.pointerEvents;
        } catch (e) {}
    });

    (state.pausedMedia || []).forEach(function(media) {
        try {
            if (media.play) {
                media.play();
            }
        } catch (e) {}
    });
}

function getPendingMediaCount() {
    var pending = 0;

    Array.prototype.slice.call(document.images || []).forEach(function(image) {
        if (!image.complete) {
            pending++;
        }
    });

    Array.prototype.slice.call(document.querySelectorAll('video, audio')).forEach(function(media) {
        if (!media.paused && !media.ended) {
            pending++;
        }
    });

    return pending;
}

function waitForCaptureSettled(scrollRoot, callback) {
    var startedAt = Date.now();
    var lastSignature = null;
    var stableFrames = 0;

    function sample() {
        var scroll = readScroll(scrollRoot);
        var signature = [
            scroll.x,
            scroll.y,
            document.documentElement.scrollHeight,
            document.documentElement.scrollWidth,
            scrollRoot ? scrollRoot.scrollHeight : 0,
            scrollRoot ? scrollRoot.scrollWidth : 0,
            getPendingMediaCount(),
            document.readyState
        ].join('|');

        if (signature === lastSignature) {
            stableFrames++;
        } else {
            stableFrames = 0;
            lastSignature = signature;
        }

        var elapsed = Date.now() - startedAt;
        if (elapsed >= CAPTURE_MIN_DELAY && stableFrames >= 2) {
            callback();
            return;
        }

        if (elapsed >= CAPTURE_MAX_DELAY) {
            callback();
            return;
        }

        window.requestAnimationFrame(sample);
    }

    window.requestAnimationFrame(sample);
}

function warmupScrollPass(scrollRoot, positions, callback) {
    var index = 0;
    var settleDelay = Math.max(80, Math.min(150, CAPTURE_MIN_DELAY));

    function step() {
        if (index >= positions.length) {
            scrollToPosition(scrollRoot, 0, 0);
            window.setTimeout(callback, settleDelay);
            return;
        }

        scrollToPosition(scrollRoot, 0, positions[index]);
        index++;
        window.setTimeout(step, settleDelay);
    }

    step();
}

function onMessage(data, sender, callback) {
    if (!data || typeof data.msg === 'undefined') {
        return;
    }

    if (data.msg === 'scrollPage') {
        getPositions(callback);
        return true;
    } else if (data.msg == 'logMessage') {
        console.log('[POPUP LOG]', data.data);
    } else {
        console.error('Unknown message received from background: ' + data.msg);
    }
}

if (!window.hasScreenCapturePage) {
    window.hasScreenCapturePage = true;
    chrome.runtime.onMessage.addListener(onMessage);
}

function max(nums) {
    return Math.max.apply(Math, nums.filter(function(x) { return x; }));
}

function getPositions(callback) {

    var body = document.body,
        scrollRoot = getScrollRoot(),
        originalBodyOverflowYStyle = body ? body.style.overflowY : '',
        originalScroll = readScroll(scrollRoot),
        originalOverflowStyle = document.documentElement.style.overflow,
        captureState = null;

    // try to make pages with bad scrolling work, e.g., ones with
    // `body { overflow-y: scroll; }` can break `window.scrollTo`
    if (body) {
        body.style.overflowY = 'visible';
    }

    var widths = [
            document.documentElement.clientWidth,
            body ? body.scrollWidth : 0,
            document.documentElement.scrollWidth,
            body ? body.offsetWidth : 0,
            document.documentElement.offsetWidth,
            scrollRoot ? scrollRoot.clientWidth : 0,
            scrollRoot ? scrollRoot.scrollWidth : 0
        ],
        heights = [
            document.documentElement.clientHeight,
            body ? body.scrollHeight : 0,
            document.documentElement.scrollHeight,
            body ? body.offsetHeight : 0,
            document.documentElement.offsetHeight,
            scrollRoot ? scrollRoot.clientHeight : 0,
            scrollRoot ? scrollRoot.scrollHeight : 0
            // (Array.prototype.slice.call(document.getElementsByTagName('*'), 0)
            //  .reduce(function(val, elt) {
            //      var h = elt.offsetHeight; return h > val ? h : val;
            //  }, 0))
        ],
        fullWidth = max(widths),
        fullHeight = max(heights),
        windowWidth = (scrollRoot && scrollRoot.clientWidth) || window.innerWidth,
        windowHeight = (scrollRoot && scrollRoot.clientHeight) || window.innerHeight,
        arrangements = [],
        // pad the vertical scrolling to try to deal with
        // sticky headers, 250 is an arbitrary size
        scrollPad = Math.max(80, Math.min(120, Math.floor(windowHeight * 0.1))),
        yDelta = windowHeight - (windowHeight > scrollPad ? scrollPad : 0),
        xDelta = windowWidth,
        yPos = fullHeight - windowHeight,
        xPos,
        numArrangements;

    // During zooming, there can be weird off-by-1 types of things...
    if (fullWidth <= xDelta + 1) {
        fullWidth = xDelta;
    }

    // Disable all scrollbars. We'll restore the scrollbar state when we're done
    // taking the screenshots.
    document.documentElement.style.overflow = 'hidden';

    while (yPos >= 0) {
        xPos = 0;
        while (xPos < fullWidth) {
            arrangements.push([xPos, yPos]);
            xPos += xDelta;
        }
        yPos -= yDelta;
    }

    // On some page heights, stepping by yDelta never lands exactly at 0.
    // Missing the y=0 frame leaves a black gap at the top in the final image.
    var hasTopRow = arrangements.some(function(pos) {
        return pos[1] === 0;
    });
    if (!hasTopRow) {
        xPos = 0;
        while (xPos < fullWidth) {
            arrangements.push([xPos, 0]);
            xPos += xDelta;
        }
    }

    if (arrangements.length === 0) {
        arrangements.push([0, 0]);
    }

    var warmupPositions = [];
    arrangements.forEach(function(pos) {
        if (!warmupPositions.length || warmupPositions[warmupPositions.length - 1] !== pos[1]) {
            warmupPositions.push(pos[1]);
        }
    });

    /** */
    console.log('fullHeight', fullHeight, 'fullWidth', fullWidth);
    console.log('windowWidth', windowWidth, 'windowHeight', windowHeight);
    console.log('xDelta', xDelta, 'yDelta', yDelta);
    var arText = [];
    arrangements.forEach(function(x) { arText.push('['+x.join(',')+']'); });
    console.log('arrangements', arText.join(', '));
    /**/

    numArrangements = arrangements.length;

    function cleanUp() {
        document.documentElement.style.overflow = originalOverflowStyle;
        if (body) {
            body.style.overflowY = originalBodyOverflowYStyle;
        }
        scrollToPosition(scrollRoot, originalScroll.x, originalScroll.y);
        if (captureState) {
            restoreCaptureState(captureState);
            captureState = null;
        }
    }

    warmupScrollPass(scrollRoot, warmupPositions, function() {
        captureState = collectCaptureState();

        (function processArrangements() {
            if (!arrangements.length) {
                cleanUp();
                if (callback) {
                    callback();
                }
                return;
            }

            var next = arrangements.shift(),
                x = next[0], y = next[1];

            scrollToPosition(scrollRoot, x, y);

            var data = {
                msg: 'capture',
                x: readScroll(scrollRoot).x,
                y: readScroll(scrollRoot).y,
                complete: (numArrangements-arrangements.length)/numArrangements,
                windowWidth: windowWidth,
                totalWidth: fullWidth,
                totalHeight: fullHeight,
                devicePixelRatio: window.devicePixelRatio
            };

            // console.log('>> DATA', JSON.stringify(data, null, 4));

            waitForCaptureSettled(scrollRoot, function() {
                // In case the below callback never returns, cleanup
                var cleanUpTimeout = window.setTimeout(cleanUp, 6000);

                chrome.runtime.sendMessage(data, function(captured) {
                    window.clearTimeout(cleanUpTimeout);

                    if (chrome.runtime.lastError) {
                        cleanUp();
                        return;
                    }

                    if (captured) {
                        // Move on to capture next arrangement.
                        processArrangements();
                    } else {
                        // If there's an error in popup.js, the response value can be
                        // undefined, so cleanup
                        cleanUp();
                    }
                });
            });
        })();
    });

}