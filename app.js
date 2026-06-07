// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// 💡 대량 멀티 의뢰서 관리를 위한 전역 마스터 상태 변수
let allOrders = [];         // PDF에서 추출한 의뢰서 전체 목록 (의뢰서 단위로 저장)
let filteredOrders = [];    // 검색어가 적용된 의뢰서 목록
let targetModels = [];      // 현재 화면에 띄워진 의뢰서의 완제품 모델명 대조군

let currentOrderIndex = 0;  // 현재 화면에 보여지고 있는 의뢰서의 인덱스 번호 (0부터 시작)

// ==========================================
// 1. 대량 PDF 데이터 분석 및 의뢰서별 구조화 파싱
// ==========================================
document.getElementById("pdfFile").addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li style='list-style:none; color:#2563eb; font-weight:bold;'>📄 대량 설치의뢰서 통합 분석 중... 잠시만 기다려 주세요.</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const totalPdfPages = pdf.numPages; // 전체 PDF 페이지 수 추출
            
            allOrders = []; // 마스터 데이터 초기화

            // 🔄 각 페이지(의뢰서 1장씩)를 정밀 추적하며 루프 생성
            for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textData = await page.getTextContent();
                
                // 텍스트 파싱 및 특수문자 정제
                const textItems = textData.items.map(item => {
                    return item.str.replace(/[\r\n\t"']/g, '').trim();
                }).filter(item => item !== "");

                if (textItems.length === 0) continue;

                // 🕵️‍♂️ 1. 해당 페이지의 [설치기사] 찾기
                let technicianName = "미지정";
                const techIndex = textItems.findIndex(text => text === "설치기사");
                if (techIndex !== -1 && textItems[techIndex + 1]) {
                    technicianName = textItems[techIndex + 1].replace(/\s+/g, '');
                }

                // 🕵️‍♂️ 2. 해당 페이지의 [고객명] 찾기
                let customerName = "미확인";
                const customerIndex = textItems.findIndex(text => text === "고객명");
                if (customerIndex !== -1 && textItems[customerIndex + 1]) {
                    customerName = textItems[customerIndex + 1].replace(/\s+/g, '');
                }

                let products = [];

                // 📋 3. 해당 페이지 내부의 주문 품목 테이블 파싱 루프
                for (let i = 0; i < textItems.length; i++) {
                    const item = textItems[i];
                    const upperItem = item.toUpperCase();

                    // 영어와 숫자가 혼합된 완제품/자재 코드 정규식 대조
                    if (/^[A-Z0-9._-]+$/i.test(upperItem)) {
                        
                        // 🛑 [안전장치] 자재 부품 코드(PQ로 시작)는 무조건 제외
                        if (upperItem.startsWith('PQ')) continue; 
                        // 순수 숫자 또는 비정상적으로 짧은 텍스트 제외
                        if (upperItem.length < 5 || /^\d+$/.test(upperItem)) continue;
                        if (/^\d+-\d+/.test(upperItem)) continue;

                        let quantity = "1";
                        let orderType = "미확인";

                        // 주변 텍스트 환경 탐색을 통해 '일반' 배차 수량 정보 매칭
                        for (let j = Math.max(0, i - 2); j < Math.min(textItems.length, i + 15); j++) {
                            if (textItems[j].includes("일반") || textItems[j].includes("특수")) {
                                orderType = "일반";
                                if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1])) quantity = textItems[j-1];
                                else if (textItems[j-2] && /^[1-9]$/.test(textItems[j-2])) quantity = textItems[j-2];
                                else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1])) quantity = textItems[j+1];
                                break;
                            }
                        }

                        // 진짜 에어컨 실물 모델명(SQ, FQ 등 일반 배차 제품)만 수집
                        if (orderType === "일반") {
                            let cleanModel = upperItem.split('.')[0].trim();
                            if (!cleanModel.startsWith('PQ')) {
                                products.push({
                                    model: cleanModel,
                                    qty: quantity
                                });
                            }
                        }
                    }
                }

                // 중복 추출된 모델명 정리
                const uniqueProducts = [];
                const seenModels = new Set();
                products.forEach(p => {
                    if (!seenModels.has(p.model)) {
                        seenModels.add(p.model);
                        uniqueProducts.push(p);
                    }
                });

                // 📦 4. 파싱된 결과를 하나의 '독립된 의뢰서 객체'로 묶어 마스터 배열에 적재
                if (uniqueProducts.length > 0) {
                    allOrders.push({
                        pdfPage: pageNum,
                        technician: technicianName,
                        customer: customerName,
                        items: uniqueProducts
                    });
                }
            }

            // 분석 종료 후 필터링 배열에 복사 및 첫 페이지 활성화
            filteredOrders = [...allOrders];
            currentOrderIndex = 0;
            
            // 화면 렌더링
            renderCurrentOrder();

        } catch (error) {
            console.error(error);
            orderList.innerHTML = "<li style='color:red;'>설치의뢰서 통합 파일 해석에 실패했습니다. 올바른 양식의 PDF인지 확인해 주세요.</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 🔄 현재 인덱스(선택된 의뢰서) 한 장의 데이터를 화면에 출력하는 함수
// ==========================================
function renderCurrentOrder() {
    const orderList = document.getElementById("orderList");
    const pageIndicator = document.getElementById("pageIndicator");
    const statusDiv = document.getElementById("status");

    // 조회 데이터가 전혀 없을 때의 예외 처리
    if (filteredOrders.length === 0) {
        orderList.innerHTML = `
            <li style="list-style:none; background:#f1f5f9; padding:15px; border-radius:6px; color:#475569; text-align:center;">
                ⚠️ 검색 조건에 부합하거나 파싱 가능한 설치의뢰서가 존재하지 않습니다.
            </li>`;
        pageIndicator.innerText = "의뢰서 건수: 0 / 0";
        targetModels = [];
        if (statusDiv) statusDiv.innerText = "확인완료 0 / 0";
        return;
    }

    // 인덱스 안전 가드레일 설정
    if (currentOrderIndex >= filteredOrders.length) currentOrderIndex = filteredOrders.length - 1;
    if (currentOrderIndex < 0) currentOrderIndex = 0;

    // 현재 타겟팅된 의뢰서 데이터 바인딩
    const currentOrder = filteredOrders[currentOrderIndex];

    // 💡 중요: 바코드 사진 인식이 들어왔을 때 대조할 실시간 타겟 모델명 정보 동기화
    targetModels = currentOrder.items.map(p => p.model);

    // HTML 인터페이스 구성
    let htmlContent = `
        <div style="background:#e0f2fe; color:#0369a1; padding:10px 15px; border-radius:6px; margin-bottom:15px; font-weight:bold; display:flex; justify-content:space-between; align-items:center;">
            <span>👷 담당 설치기사: <span style="font-size:16px; color:#0284c7;">${currentOrder.technician}</span> 기사님</span>
            <span style="font-size:12px; background:white; padding:2px 6px; border-radius:4px; color:#64748b;">PDF ${currentOrder.pdfPage} 페이지</span>
        </div>
        <div style="margin-bottom: 12px; font-size:14px; color:#475569;">
            👤 <b>고객명:</b> ${currentOrder.customer} 고객님
        </div>
    `;

    currentOrder.items.forEach((prod, idx) => {
        htmlContent += `
            <div style="margin-bottom: 12px; border:1px solid #e2e8f0; padding:12px; border-radius:6px; background:white;">
                <b style="color:#4f46e5; font-size:14px;">[품목 ${idx + 1}]</b><br>
                • <b style="font-size:14px;">모델명:</b> <span style="color:#b91c1c; font-weight:bold; font-size:15px;">${prod.model}</span><br>
                • <b>배정수량:</b> <span style="font-weight:bold; color:#1e293b;">${prod.qty}</span> 개
            </div>
        `;
    });

    orderList.innerHTML = htmlContent;

    // 하단 페이징 인디케이터 및 상단 검수 진행 상태바 업데이트
    pageIndicator.innerText = `의뢰서 건수: ${currentOrderIndex + 1} / ${filteredOrders.length} (총 ${allOrders.length}장 중)`;
    if (statusDiv) statusDiv.innerText = `현재 페이지 검수 대기 0 / ${targetModels.length}`;
}

// ==========================================
// ◀ ▶ 이전 / 다음 의뢰서 페이지 탐색 버튼 이벤트
// ==========================================
document.getElementById("prevPageBtn").addEventListener("click", function () {
    if (currentOrderIndex > 0) {
        currentOrderIndex--;
        renderCurrentOrder();
    } else {
        alert("첫 번째 설치의뢰서 페이지입니다.");
    }
});

document.getElementById("
