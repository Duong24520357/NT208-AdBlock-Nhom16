// Element picker UI and logic moved from content.js
(function () {
    function startElementPicker() {
        let hoveredElement = null;

        // Thêm style highlight khi hover
        const style = document.createElement("style");
        style.id = "adblock-picker-style";
        style.textContent = `
            .adblock-highlight {
                outline: 2px solid red !important;
                cursor: crosshair !important;
            }
        `;
        document.head.appendChild(style);

        // Highlight element khi di chuột
        function onMouseOver(e) {
            if (hoveredElement) {
                hoveredElement.classList.remove("adblock-highlight");
            }
            hoveredElement = e.target;
            hoveredElement.classList.add("adblock-highlight");
            e.stopPropagation();
        }

        // Click để chọn element → tạo selector → gửi lên background
        function onMouseClick(e) {
            e.preventDefault();
            e.stopPropagation();

            if (hoveredElement) {
                // Tạo selector đơn giản từ element được chọn
                const selector = generateSelector(hoveredElement);

                // Ẩn element đã chọn và collapse nếu cần
                // `hideAndCollapse` is expected to be available globally
                try {
                    window.hideAndCollapse?.(hoveredElement);
                    hoveredElement.dataset.adblockHidden = "true";
                } catch (err) { /* ignore */ }

                // Gửi selector lên background để lưu
                chrome.runtime.sendMessage({
                    type: "ADD_CUSTOM_FILTER",
                    filter: selector
                });
            }

            // Dừng element picker
            stopElementPicker(onMouseOver, onMouseClick, onKeyDown);
        }

        // Nhấn ESC để thoát
        function onKeyDown(e) {
            if (e.key === "Escape") {
                stopElementPicker(onMouseOver, onMouseClick, onKeyDown);
            }
        }

        document.addEventListener("mouseover", onMouseOver);
        document.addEventListener("click", onMouseClick);
        document.addEventListener("keydown", onKeyDown);
    }

    // Dừng element picker và dọn dẹp
    function stopElementPicker(onMouseOver, onMouseClick, onKeyDown) {
        document.removeEventListener("mouseover", onMouseOver);
        document.removeEventListener("click", onMouseClick);
        document.removeEventListener("keydown", onKeyDown);

        // Xóa highlight còn lại
        document.querySelectorAll(".adblock-highlight")
            .forEach(el => el.classList.remove("adblock-highlight"));

        // Xóa style
        document.getElementById("adblock-picker-style")?.remove();

        console.log("[AdBlock] Element picker đã tắt");
    }

    // Tạo CSS selector từ element
    function generateSelector(element) {
        if (!element) return "";
        if (element.id) {
            return `#${element.id}`;
        }
        if (element.className) {
            try {
                const classes = Array.from(element.classList).join(".");
                return `${element.tagName.toLowerCase()}.${classes}`;
            } catch (e) {
                return element.tagName.toLowerCase();
            }
        }
        return element.tagName.toLowerCase();
    }

    window.ElementPicker = {
        start: startElementPicker,
        stop: stopElementPicker,
        generateSelector
    };
})();
