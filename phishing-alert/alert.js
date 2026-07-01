document.addEventListener('DOMContentLoaded', () => {
    const btnBack = document.getElementById('btn-back');
    const btnClose = document.getElementById('btn-close');

    if (btnBack) {
        btnBack.addEventListener('click', () => {
            window.history.back(); 
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            window.close(); 
        });
    }
});