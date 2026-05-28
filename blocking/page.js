
var CAPTURE_DELAY = 600;

function getScrollRoot() {
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

function onMessage(data, sender, callback) {
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
        originalOverflowStyle = document.documentElement.style.overflow;

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
        scrollPad = 200,
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
    }

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

        // Need to wait for things to settle
        window.setTimeout(function() {
            // In case the below callback never returns, cleanup
            var cleanUpTimeout = window.setTimeout(cleanUp, 6000);

            chrome.runtime.sendMessage(data, function(captured) {
                window.clearTimeout(cleanUpTimeout);

                if (captured) {
                    // Move on to capture next arrangement.
                    processArrangements();
                } else {
                    // If there's an error in popup.js, the response value can be
                    // undefined, so cleanup
                    cleanUp();
                }
            });

        }, CAPTURE_DELAY);
    })();
}