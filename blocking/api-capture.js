
window.CaptureAPI = (function() {

    var MAX_PRIMARY_DIMENSION = 15000 * 2,
        MAX_SECONDARY_DIMENSION = 4000 * 2,
        MAX_AREA = MAX_PRIMARY_DIMENSION * MAX_SECONDARY_DIMENSION;

    var MIN_CAPTURE_INTERVAL_MS = 300,
        lastCaptureAt = 0;


    //
    // URL Matching test - to verify we can talk to this URL
    //

    var matches = ['http://*/*', 'https://*/*', 'ftp://*/*', 'file://*/*'],
        noMatches = [/^https?:\/\/chrome.google.com\/.*$/];

    function isValidUrl(url) {
        // couldn't find a better way to tell if executeScript
        // wouldn't work -- so just testing against known urls
        // for now...
        var r, i;
        for (i = noMatches.length - 1; i >= 0; i--) {
            if (noMatches[i].test(url)) {
                return false;
            }
        }
        for (i = matches.length - 1; i >= 0; i--) {
            r = new RegExp('^' + matches[i].replace(/\*/g, '.*') + '$');
            if (r.test(url)) {
                return true;
            }
        }
        return false;
    }


    function initiateCapture(tab, callback) {
        chrome.tabs.sendMessage(tab.id, {msg: 'scrollPage'}, function() {
            if (chrome.runtime.lastError) {
                console.warn('Capture handshake failed:', chrome.runtime.lastError.message);
                callback();
                return;
            }

            // We're done taking snapshots of all parts of the window. Display
            // the resulting full screenshot images in a new browser tab.
            callback();
        });
    }


    function capture(data, screenshots, sendResponse, splitnotifier, attemptsLeft) {
        attemptsLeft = typeof attemptsLeft === 'number' ? attemptsLeft : 3;

        var elapsed = Date.now() - lastCaptureAt;
        var waitTime = Math.max(0, MIN_CAPTURE_INTERVAL_MS - elapsed);

        window.setTimeout(function() {
            chrome.tabs.captureVisibleTab(
                null, {format: 'png'}, function(dataURI) {
                    var captureError = chrome.runtime.lastError;
                    if (captureError || !dataURI) {
                        if (attemptsLeft > 0) {
                            capture(data, screenshots, sendResponse, splitnotifier, attemptsLeft - 1);
                            return;
                        }
                        sendResponse(false);
                        return;
                    }

                    lastCaptureAt = Date.now();

                    var image = new Image();
                    image.onload = function() {
                        data.image = {width: image.width, height: image.height};

                        // given device mode emulation or zooming, we may end up with
                        // a different sized image than expected, so let's adjust to
                        // match it!
                        if (data.windowWidth && data.windowWidth !== image.width) {
                            var scale = image.width / data.windowWidth;
                            data.x = Math.round(data.x * scale);
                            data.y = Math.round(data.y * scale);
                            data.totalWidth = Math.round(data.totalWidth * scale);
                            data.totalHeight = Math.round(data.totalHeight * scale);
                        }

                        // lazy initialization of screenshot canvases (since we need to wait
                        // for actual image size)
                        if (!screenshots.length) {
                            Array.prototype.push.apply(
                                screenshots,
                                _initScreenshots(data.totalWidth, data.totalHeight)
                            );
                            if (screenshots.length > 1 && splitnotifier) {
                                splitnotifier();
                            }
                        }

                        // draw it on matching screenshot canvases
                        _filterScreenshots(
                            data.x, data.y, image.width, image.height, screenshots
                        ).forEach(function(screenshot) {
                            screenshot.ctx.drawImage(
                                image,
                                data.x - screenshot.left,
                                data.y - screenshot.top
                            );
                        });

                        // send back log data for debugging (but keep it truthy to
                        // indicate success)
                        sendResponse(JSON.stringify(data, null, 4) || true);
                    };
                    image.onerror = function() {
                        sendResponse(false);
                    };
                    image.src = dataURI;
                }
            );
        }, waitTime);
    }


    function _initScreenshots(totalWidth, totalHeight) {
        // Create and return an array of screenshot objects based
        // on the `totalWidth` and `totalHeight` of the final image.
        // We have to account for multiple canvases if too large,
        // because Chrome won't generate an image otherwise.
        //
        var badSize = (totalHeight > MAX_PRIMARY_DIMENSION ||
                       totalWidth > MAX_PRIMARY_DIMENSION ||
                       totalHeight * totalWidth > MAX_AREA),
            biggerWidth = totalWidth > totalHeight,
            maxWidth = (!badSize ? totalWidth :
                        (biggerWidth ? MAX_PRIMARY_DIMENSION : MAX_SECONDARY_DIMENSION)),
            maxHeight = (!badSize ? totalHeight :
                         (biggerWidth ? MAX_SECONDARY_DIMENSION : MAX_PRIMARY_DIMENSION)),
            numCols = Math.ceil(totalWidth / maxWidth),
            numRows = Math.ceil(totalHeight / maxHeight),
            row, col, canvas, left, top;

        var canvasIndex = 0;
        var result = [];

        for (row = 0; row < numRows; row++) {
            for (col = 0; col < numCols; col++) {
                canvas = document.createElement('canvas');
                canvas.width = (col == numCols - 1 ? totalWidth % maxWidth || maxWidth :
                                maxWidth);
                canvas.height = (row == numRows - 1 ? totalHeight % maxHeight || maxHeight :
                                 maxHeight);

                left = col * maxWidth;
                top = row * maxHeight;

                result.push({
                    canvas: canvas,
                    ctx: canvas.getContext('2d'),
                    index: canvasIndex,
                    left: left,
                    right: left + canvas.width,
                    top: top,
                    bottom: top + canvas.height
                });

                canvasIndex++;
            }
        }

        return result;
    }


    function _filterScreenshots(imgLeft, imgTop, imgWidth, imgHeight, screenshots) {
        // Filter down the screenshots to ones that match the location
        // of the given image.
        //
        var imgRight = imgLeft + imgWidth,
            imgBottom = imgTop + imgHeight;
        return screenshots.filter(function(screenshot) {
            return (imgLeft < screenshot.right &&
                    imgRight > screenshot.left &&
                    imgTop < screenshot.bottom &&
                    imgBottom > screenshot.top);
        });
    }


    function getBlobs(screenshots) {
        return screenshots.map(function(screenshot) {
            var dataURI = screenshot.canvas.toDataURL();

            // convert base64 to raw binary data held in a string
            // doesn't handle URLEncoded DataURIs
            var byteString = atob(dataURI.split(',')[1]);

            // separate out the mime component
            var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

            // write the bytes of the string to an ArrayBuffer
            var ab = new ArrayBuffer(byteString.length);
            var ia = new Uint8Array(ab);
            for (var i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }

            // create a blob for writing to a file
            var blob = new Blob([ab], {type: mimeString});
            return blob;
        });
    }


    function saveBlob(blob, filename, index, callback, errback) {
        filename = _addFilenameSuffix(filename, index);

        function onwriteend() {
            // open the file that now contains the blob - calling
            // `openPage` again if we had to split up the image
            var urlName = ('filesystem:chrome-extension://' +
                           chrome.i18n.getMessage('@@extension_id') +
                           '/temporary/' + filename);

            callback(urlName);
        }

        // come up with file-system size with a little buffer
        var size = blob.size + (1024 / 2);

        // create a blob for writing to a file
        var reqFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
        reqFileSystem(window.TEMPORARY, size, function(fs){
            fs.root.getFile(filename, {create: true}, function(fileEntry) {
                fileEntry.createWriter(function(fileWriter) {
                    fileWriter.onwriteend = onwriteend;
                    fileWriter.write(blob);
                }, errback); // TODO - standardize error callbacks?
            }, errback);
        }, errback);
    }


    function _addFilenameSuffix(filename, index) {
        if (!index) {
            return filename;
        }
        var sp = filename.split('.');
        var ext = sp.pop();
        return sp.join('.') + '-' + (index + 1) + '.' + ext;
    }


    function captureToBlobs(tab, callback, errback, progress, splitnotifier) {
        var loaded = false,
            screenshots = [],
            timeout = 8000,
            timedOut = false,
            noop = function() {};
        var listener;

        function cleanupListener() {
            if (listener) {
                chrome.runtime.onMessage.removeListener(listener);
                listener = null;
            }
        }

        callback = callback || noop;
        errback = errback || noop;
        progress = progress || noop;

        if (!isValidUrl(tab.url)) {
            cleanupListener();
            errback('invalid url'); // TODO errors
            return;
        }

        // TODO will this stack up if run multiple times? (I think it will get cleared?)
        listener = function(request, sender, sendResponse) {
            if (request.msg === 'capture') {
                progress(request.complete);
                capture(request, screenshots, sendResponse, splitnotifier);

                // https://developer.chrome.com/extensions/messaging#simple
                //
                // If you want to asynchronously use sendResponse, add return true;
                // to the onMessage event handler.
                //
                return true;
            } else {
                console.error('Unknown message received from content script: ' + request.msg);
                cleanupListener();
                errback('internal error');
                return false;
            }
        };

        chrome.runtime.onMessage.addListener(listener);

        chrome.scripting.executeScript(
            {
                target: {tabId: tab.id},
                files: ['blocking/page.js']
            },
            function() {
            if (chrome.runtime.lastError) {
                cleanupListener();
                errback(chrome.runtime.lastError.message || 'execute failed');
                return;
            }

            if (timedOut) {
                console.error('Timed out too early while waiting for ' +
                              'chrome.tabs.executeScript. Try increasing the timeout.');
            } else {
                loaded = true;
                progress(0);

                initiateCapture(tab, function() {
                    cleanupListener();
                    callback(getBlobs(screenshots));
                });
            }
            }
        );

        window.setTimeout(function() {
            if (!loaded) {
                timedOut = true;
                cleanupListener();
                errback('execute timeout');
            }
        }, timeout);
    }


    function captureToFiles(tab, filename, callback, errback, progress, splitnotifier) {
        captureToBlobs(tab, function(blobs) {
            var i = 0,
                len = blobs.length,
                filenames = [];

            (function doNext() {
                saveBlob(blobs[i], filename, i, function(filename) {
                    i++;
                    filenames.push(filename);
                    i >= len ? callback(filenames) : doNext();
                }, errback);
            })();
        }, errback, progress, splitnotifier);
    }


    return {
        captureToBlobs: captureToBlobs,
        captureToFiles: captureToFiles
    };

})();