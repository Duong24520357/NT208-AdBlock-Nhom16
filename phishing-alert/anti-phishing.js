// File: anti-phishing.js
console.log("Module Anti-Phishing (Bản Pro) đã khởi động!");

// 1. Danh sách đen mặc định (Phòng trường hợp mất mạng không tải được dữ liệu mới)
let phishingDomains = [
    "luadao-facebook.com",
    "nhanqua-garena-mienphi.vn"
];

// 2. Hàm chuyển đổi danh sách tên miền thành Rules của Chrome
function applyRules(domains) {
    const rules = domains.map((domain, index) => {
        return {
            id: index + 10000, // ID bắt đầu từ 10000 để không trùng với AdBlock
            priority: 2, // Độ ưu tiên cao
            action: { 
                type: "redirect",
                redirect: { extensionPath: "/phishing-alert/phishing-alert.html" } // Trỏ về trang đỏ
            },
            condition: {
                urlFilter: domain,
                resourceTypes: ["main_frame"] // Chỉ chặn khi load cả trang
            }
        };
    });

    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: rules.map(rule => rule.id), // Xóa rule cũ
        addRules: rules // Áp dụng rule mới
    }, () => {
        console.log(`Đã cập nhật thành công ${domains.length} quy tắc chống Phishing!`);
    });
}

// 3. (TÍNH NĂNG MỞ RỘNG) Cập nhật danh sách đen từ Server (GitHub)
async function fetchDynamicBlacklist() {
    try {
        // Đây là link giả lập. Nhóm bạn có thể tự tạo 1 file blacklist.json đẩy lên GitHub
        // và dán link dạng Raw vào đây để điều khiển từ xa!
        const response = await fetch ('https://raw.githubusercontent.com/Duong24520357/NT208-AdBlock-Nhom16/refs/heads/feature/anti-phishing/blacklist.json');
        
        if (response.ok) {
            const data = await response.json();
            // Nếu fetch thành công, ghi đè danh sách mặc định
            if (data && data.domains) {
                phishingDomains = data.domains;
                console.log("Đã tải danh sách đen mới nhất từ Server.");
            }
        }
    } catch (error) {
        console.log("Không thể kết nối máy chủ, sử dụng danh sách đen mặc định cục bộ.");
    } finally {
        // Dù thành công hay thất bại (mất mạng), vẫn phải áp dụng lệnh chặn
        applyRules(phishingDomains);
    }
}

// 4. Kích hoạt toàn bộ quy trình khi tiện ích được bật lên
chrome.runtime.onInstalled.addListener(() => {
    fetchDynamicBlacklist();
});

// Kích hoạt khi Chrome khởi động lại
chrome.runtime.onStartup.addListener(() => {
    fetchDynamicBlacklist();
});