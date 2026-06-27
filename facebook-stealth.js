// ==========================================
// NINJA STEALTH V2: ĐÁNH CHẶN WINDOW.FETCH
// Bất chấp Mã hóa Đầu cuối (E2EE) của Facebook
// ==========================================

console.log("👻 [Facebook Stealth] Đã tiêm lõi vào Main World!");

const originalFetch = window.fetch;

// Cài nội gián đè lên hàm fetch mặc định của trình duyệt
window.fetch = async function(...args) {
    const url = args[0];
    const options = args[1];

    // Kiểm tra xem công tắc Tàng hình có đang bật trong LocalStorage không
    // (Vì chạy ở Main World nên không dùng được chrome.storage, phải dùng localStorage tạm)
    const isStealthOn = localStorage.getItem('fbStealthEnabled') !== 'false';

    if (isStealthOn && typeof url === 'string') {
        // Bắt các request gửi qua GraphQL hoặc Endpoint báo đọc
        if (url.includes('/api/graphql/') || url.includes('/ajax/mercury/change_read_status.php')) {
            if (options && options.body && typeof options.body === 'string') {
                
                // Nhận diện các từ khóa nhạy cảm của gói tin "Đã xem" và "Đang gõ"
                const bodyStr = options.body;
                if (bodyStr.includes('ReportMessageThreadReadStatusMutation') || 
                    bodyStr.includes('mark_read') ||
                    bodyStr.includes('MessengerTypingIndicatorMutation')) {
                    
                    console.log("🛑 [Ninja] Đã bóp cổ thành công 1 gói tin Đã Xem/Đang gõ!");
                    
                    // Trả về một Response giả vờ là đã gửi thành công để FB không báo lỗi
                    return new Response(JSON.stringify({ data: { success: true } }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }
        }
    }
    
    // Nếu không phải gói tin Đã xem, cho phép gửi đi bình thường
    return originalFetch.apply(this, args);
};

// Lắng nghe lệnh bật/tắt từ Popup truyền xuống
window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'TOGGLE_STEALTH') {
        localStorage.setItem('fbStealthEnabled', event.data.enabled);
        console.log("👻 Chế độ tàng hình: " + (event.data.enabled ? "BẬT" : "TẮT"));
    }
});