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
        console.log("⏳ Đang kết nối với OpenPhish để tải danh sách lừa đảo mới nhất...");
        
        // Gọi API lấy file text thô từ máy chủ OpenPhish
        const response = await fetch('https://openphish.com/feed.txt');
        
        if (response.ok) {
            const textData = await response.text();
            
            // 1. Tách chuỗi dài thành một mảng, mỗi dòng là 1 URL
            const urlList = textData.split('\n').filter(url => url.trim() !== '');
            
            // 2. Rút trích chỉ lấy "tên miền" (Ví dụ: từ http://luadao.com/login.php -> luadao.com)
            const fetchedDomains = urlList.map(url => {
                try { 
                    return new URL(url).hostname; 
                } catch (e) { 
                    return null; // Bỏ qua những dòng không phải định dạng URL
                }
            }).filter(domain => domain !== null);

            // 3. Lọc trùng lặp: OpenPhish có thể có 2 link lừa đảo nằm trên cùng 1 web
            // Dùng Set() để loại bỏ tên miền trùng, giúp Chrome chạy nhẹ hơn
            phishingDomains = [...new Set(fetchedDomains)];
            
            console.log(`✅ Đã tải và nạp thành công ${phishingDomains.length} tên miền lừa đảo zero-day!`);
        } else {
            console.log("❌ Máy chủ OpenPhish bận, sử dụng danh sách lưu trữ tạm trong máy.");
        }
    } catch (error) {
        console.log("🌐 Mất mạng hoặc bị chặn kết nối, sử dụng danh sách dự phòng.");
    } finally {
        // Cuối cùng: Nạp danh sách (vừa tải về hoặc mặc định) vào lõi chặn mạng của Chrome
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