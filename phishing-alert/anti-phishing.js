// File: anti-phishing.js

console.log("Module Anti-Phishing đã được khởi động!");

const phishingDomains = [
    "luadao-facebook.com",
    "nhanqua-garena-mienphi.vn"
];

const rules = phishingDomains.map((domain, index) => {
    return {
        // Cộng thêm 10000 để ID của bạn không bao giờ trùng với ID 
        id: index + 10000, 
        priority: 1,
        action: { type: "block" },
        condition: {
            urlFilter: domain,
            resourceTypes: ["main_frame"]
        }
    };
});

function updatePhishingRules() {
    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: rules.map(rule => rule.id),
        addRules: rules
    }, () => {
        console.log("Đã cập nhật danh sách chặn Phishing thành công!");
    });
}

// Chạy hàm khi extension khởi động
chrome.runtime.onInstalled.addListener(() => {
    updatePhishingRules();
});