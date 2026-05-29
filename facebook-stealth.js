// ====== CHẾ ĐỘ ẨN DANH FACEBOOK (NT208 - NHÓM 16) ======
console.log("👻 [Nhóm 16] Đã tiêm mã ẩn danh vào Facebook/Messenger!");

// 1. Lưu trữ lại hàm gửi mạng gốc của trình duyệt
const originalFetch = window.fetch;

// 2. Viết đè lên hàm gốc bằng hàm nội gián của chúng ta
window.fetch = async function(...args) {
    const url = args[0];
    const options = args[1];

    // Chỉ soi các gói tin gửi vào luồng GraphQL của Facebook
    if (typeof url === 'string' && url.includes('/graphql/') && options && options.body) {
        try {
            const bodyString = options.body.toString();

            // KỊCH BẢN 1: Bắt quả tang gói tin báo "ĐÃ XEM" (Seen)
            if (bodyString.includes('ThreadMarkReadMutation') || bodyString.includes('mark_read')) {
                console.log("🛑 [Nhóm 16] Đã tiêu hủy gói tin: ĐÃ XEM (Seen)!");
                // Trả về một Promise treo vĩnh viễn, giả vờ như đang gửi nhưng thực chất là đã bị chặn
                return new Promise(() => {}); 
            }

            // KỊCH BẢN 2: Bắt quả tang gói tin báo "ĐANG GÕ..." (Typing)
            if (bodyString.includes('TypingIndicatorMutation') || bodyString.includes('typ_snd')) {
                console.log("🛑 [Nhóm 16] Đã tiêu hủy gói tin: ĐANG GÕ... (Typing)!");
                return new Promise(() => {});
            }
        } catch (error) {
            // Nếu có lỗi lúc phân tích chuỗi, cứ cho qua để không làm sập web của người dùng
        }
    }

    // Nếu là các gói tin bình thường (tải ảnh, gửi tin nhắn đi, load bảng tin), cho phép đi qua
    return originalFetch.apply(this, args);
};