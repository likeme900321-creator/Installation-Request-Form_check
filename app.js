// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 핵심 데이터 파싱
// ==========================================
document.getElementById("pdfFile").addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li>설치의뢰서 분석 중...</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const page = await pdf.getPage(1);
            const canvas = document.getElementById("pdfViewer");
            const context = canvas.getContext("2d");
            const viewport = page.getViewport({ scale: 1.2 }); 

            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.style.display = "block";
            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const textData = await page.getTextContent();
            
            const textItems = textData.items.map(item => {
                return item.str.replace(/[\r\n\t"']/g, '').trim();
            }).filter(item => item !== "");

            pdfTextContent = textItems.join(" ");

            // 주문 품목 및 모델명 변수 초기화 (설치기사 변수 제거)
            let orderItems = [];
            targetModels = [];

            // 💡 문서 전체 루프를 돌며 품목 매칭 진행
            for (let i = 0; i < textItems.length; i++) {
                
                // ❌ [기존 설치기사 조건문 영역 완벽 삭제]
                // (기사 이름을 추출하고 덮어씌워지던 로직을 통째로 도려냈습니다.)

                // 모델명 패턴 분석 및 자재 필터 구간
                const item = textItems[i];
                if (/^[A-Z]{2,4}\d+[A-Z0-9-_.]+/i.test(item)) {
                    const upperItem = item.toUpperCase();

                    // P로 시작하는 자재 차단 시도
                    if (upperItem.startsWith('P') && !upperItem.startsWith('PQ')) {
                        continue; 
                    }

                    let quantity = "1"; 
                    let orderType = "미확인";
                    let location = "공란(미지정)";

                    // '일반' 단어 추적 및 수량 수집
                    for (let j = i + 1; j < Math.min(i + 15, textItems.length); j++) {
                        const nextItem = textItems[j];
                        if (nextItem === "일반" || nextItem === "특수") {
                            orderType = nextItem;
                            if (textItems[j-1] && /^\d+$/.test(textItems[j-1])) quantity = textItems[j-1];
                            break;
                        }
                    }

                    if (orderType === "일반") {
                        let cleanModel = item.split('.')[0].trim().toUpperCase();
                        targetModels.push(cleanModel);
                        orderItems.push({ model: cleanModel, qty: quantity, type: orderType, loc: location });
                    }
                }
            }

            // 모델명 중복 제거
            targetModels = [...new Set(targetModels)];

            // ==========================================
            // 화면 업데이트 (설치기사 표시 레이아웃 완전 제거)
            // =
