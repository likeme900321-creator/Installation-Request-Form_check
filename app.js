// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 핵심 주문 품목 파싱
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
            
            // 💡 PDF 내부 텍스트 정제 및 배열화 (따옴표, 줄바꿈 제거)
            const textItems = textData.items.map(item => {
                return item.str.replace(/[\r\n\t"']/g, '').trim();
            }).filter(item => item !== "");

            pdfTextContent = textItems.join(" ");

            // 핵심 중요 항목 변수 초기화 (설치기사 관련 데이터 수집 안 함)
            let orderItems = [];
            targetModels = [];

            // 💡 [정밀 필터] 표 내부 데이터 매칭 추출 (자재 원천 차단 + 일반 주문만)
            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];

                // 가전 완제품 모델명 패턴 분석 (영어 대문자 + 숫자 조합 형태)
                if (/^[A-Z]{2,4}\d+[A-Z0-9-_.]+/i.test(item)) {
                    
                    const upperItem = item.toUpperCase();

                    // ❌ [자재 차단] P로 시작하는 모델명은 순수 자재 부품이므로 품목 리스트에서 완벽 배제
                    // 단, PQ로 시작하는 모델명(예: PQ060907A01)은 실제 에어컨 완제품이므로 통과
                    if (upperItem.startsWith('P') && !upperItem.startsWith('PQ')) {
                        continue; 
                    }

                    let quantity = "1"; 
                    let orderType = "미확인";
                    let location = "공란(미지정)";

                    // 모델명 발견 지점 이후 영역에서 수량과 원주문구분('일반')을 추적
                    for (let j = i + 1; j < Math.min(i + 15, textItems.length); j++) {
                        const nextItem = textItems[j];

                        if (nextItem === "일반" || nextItem === "특수") {
                            orderType = nextItem;
                            
                            // '일반' 단어 주변 앞뒤에 위치한 진짜 수량(숫자) 수집
                            if (textItems[j-1] && /^\d+$/.test(textItems[j-1])) {
                                quantity = textItems[j-1];
                            } else if (textItems[j-2] && /^\d+$/.test(textItems[j-2])) {
                                quantity = textItems[j-2];
                            } else if (textItems[j+1] && /^\d+$/.test(textItems[j+1])) {
                                quantity = textItems[j+1];
                            }
                            break;
                        }
                    }

                    // 💡 오직 원주문구분이 '일반'인 제품만 최종 검수 품목으로 등록
                    if (orderType === "일반") {
                        // 모델명 뒤의 유통 코드(.AKOR 등) 제거
                        let cleanModel = item.split('.')[0].trim().toUpperCase();
                        
                        targetModels.push(cleanModel);

                        orderItems.push({
                            model: cleanModel,
                            qty: quantity,
                            type: orderType,
                            loc: location
                        });
                    }
                }
            }

            // 모델명 중복 제거
            targetModels = [...new Set(targetModels)];

            // ==========================================
            // 화면 업데이트 (설치기사 UI 레이아웃까지 완전히 제거)
            // ==========================================
            if (orderItems.length > 0) {
                let htmlContent = ""; // 상단에 기사님을 그리던 파란색 HTML 박스 영역을 완전히 삭제했습니다.
                
                // 완제품 품목 중심으로 순서대로 매핑
                orderItems.forEach((prod, index) => {
                    htmlContent += `
                        <li style="margin-bottom: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; list-style:none;">
                            <b style="color:#4f46e5; font-size:15px;">📋 [주문 품목 ${index + 1}]</b><br><br>
                            • <b>1. 모델명 :</b> <span style="color:#b91c1c; font-weight:bold; font-size:16px;">${prod.model}</span><br>
                            • <b>2. 수량 :</b> <span style="font-weight:bold;">${prod.qty}</span> 개<br>
                            • <b>3. 원주문구분 :</b> <span style="background:#fef08a; padding:1px 4px; border-radius:3px; font-weight:bold;">${prod.type}</span><br>
                            • <b>4. 제품위치 :</b> <span style="color:#64748b;">${prod.loc}</span>
                        </li>`;
                });
                
                orderList.innerHTML = htmlContent;
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                orderList.innerHTML = `
                    <li style="list-style:none; background:#f1f5f9; padding:15px; border-radius:6px; color:#475569;">
                        ⚠️ 검수 대상 제품(원주
