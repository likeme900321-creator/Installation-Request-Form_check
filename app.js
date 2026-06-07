// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// 대량 멀티 의뢰서 관리를 위한 전역 마스터 상태 변수
let allOrders = [];         // PDF에서 추출한 의뢰서 전체 목록
let filteredOrders = [];    // 검색어가 적용된 의뢰서 목록
let targetModels = [];      // 현재 화면에 띄워진 의뢰서의 완제품 모델명 대조군

let currentOrderIndex = 0;  // 현재 화면에 보여지고 있는 의뢰서의 번호 (0부터 시작)

// ==========================================
// 1. [오류 수정] 대량 PDF 안전 동기화 파싱 로직
// ==========================================
document.getElementById("pdfFile").addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li style='list-style:none; color:#2563eb; font-weight:bold;'>📄 대량 설치의뢰서 통합 분석 중... (데이터가 많아 수 초 소요될 수 있습니다)</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            // 1. PDF 문서 열기
            const pdfLoadingTask = pdfjsLib.getDocument(typedarray);
            const pdf = await pdfLoadingTask.promise;
            const totalPdfPages = pdf.numPages; 
            
            allOrders = []; // 마스터 데이터 초기화

            // 🔄 💡 [오류 해결 핵심] 각 페이지의 텍스트 추출 작업을 안전하게 순서대로 기다립니다.
            for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
                try {
                    const page = await pdf.getPage(pageNum);
                    const textData = await page.getTextContent();
                    
                    // 텍스트 파싱 및 특수문자 정제
                    const textItems = textData.items.map(item => {
                        return item.str ? item.str.replace(/[\r\n\t"']/g, '').trim() : "";
                    }).filter(item => item !== "");

                    if (textItems.length === 0) continue;

                    // 🕵️‍♂️ 해당 페이지의 [설치기사] 찾기
                    let technicianName = "미지정";
                    const techIndex = textItems.findIndex(text => text === "설치기사");
                    if (techIndex !== -1 && textItems[techIndex + 1]) {
                        technicianName = textItems[techIndex + 1].replace(/\s+/g, '');
                    }

                    // 🕵️‍♂️ 해당 페이지의 [고객명] 찾기
                    let customerName = "미확인";
                    const customerIndex = textItems.findIndex(text => text === "고객명");
                    if (customerIndex !== -1 && textItems[customerIndex + 1]) {
                        customerName = textItems[customerIndex + 1].replace(/\s+/g, '');
                    }

                    let products = [];

                    // 📋 해당 페이지 내부의 주문 품목 테이블 파싱 루프
                    for (let i = 0; i < textItems.length; i++) {
                        const item = textItems[i];
                        const upperItem = item.toUpperCase();

                        if (/^[A-Z0-9._-]+$/i.test(upperItem)) {
                            // 자재 부품 코드(PQ로 시작) 및 불필요 코드는 대량 파싱 시 무조건 패스
                            if (upperItem.startsWith('PQ')) continue; 
                            if (upperItem.length < 5 || /^\d+$/.test(upperItem)) continue;
                            if (/^\d+-\d+/.test(upperItem)) continue;

                            let quantity = "1";
                            let orderType = "미확인";

                            // 주변 환경 탐색 ('일반' 배차 수량 확인)
                            for (let j = Math.max(0, i - 2); j < Math.min(textItems.length, i + 15); j++) {
                                if (textItems[j].includes("일반") || textItems[j].includes("특수")) {
                                    orderType = "일반";
                                    if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1])) quantity = textItems[j-1];
                                    else if (textItems[j-2] && /^[1-9]$/.test(textItems[j-2])) quantity = textItems[j-2];
                                    else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1])) quantity = textItems[j+1];
                                    break;
                                }
                            }

                            // 진짜 에어컨 실물 완제품 모델명만 수집
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

                    // 중복 모델명 제거
                    const uniqueProducts = [];
                    const seenModels = new Set();
                    products.forEach(p => {
                        if (!seenModels.has(p.model)) {
                            seenModels.add(p.model);
                            uniqueProducts.push(p);
                        }
                    });

                    // 데이터가 유효한 의뢰서만 마스터 배열에 순차 적재
                    if (uniqueProducts.length > 0) {
                        allOrders.push({
                            pdfPage: pageNum,
                            technician: technicianName,
                            customer: customerName,
                            items: uniqueProducts
                        });
                    }
                } catch (pageError) {
                    console.error(`${pageNum}페이지 파싱 중 건너뜀 오류:`, pageError);
                    // 특정 페이지에 에러가 나도 전체가 멈추지 않고 다음 장으로 넘어가도록 안전 가드 장착
                    continue;
                }
            }

            // 분석 종료 후 복사 및 첫 페이지 활성화
            filteredOrders = [...allOrders];
            currentOrderIndex = 0;
            
            // 화면 렌더링 호출
            renderCurrentOrder();

        } catch (error) {
            console.error("전체 PDF 로딩 오류:", error);
            orderList.innerHTML = "<li style='color:red; list-style:none;'>⚠️ PDF 파일을 불러오는 과정에서 오류가 발생했습니다. 파일이 손상되었거나 브라우저 메모리가 부족할 수 있습니다. 다시 시도해 주세요.</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 🔄 현재 인덱스의 의뢰서 데이터를 화면에 띄우는 함수
// ==========================================
function renderCurrentOrder() {
    const orderList = document.getElementById("orderList");
    const pageIndicator = document.getElementById("pageIndicator");
    const statusDiv = document.getElementById("status");

    if (filteredOrders.length === 0) {
        orderList.innerHTML = `
            <li style="list-style:none; background:#f1f5f9; padding:15px; border-radius:6px; color:#475569; text-align:center;">
                ⚠️ 파싱 가능한 완제품(일반배차) 의뢰서가 존재하지 않거나 일치하는 기사가 없습니다.
            </li>`;
        pageIndicator.innerText = "의뢰서 건수: 0 / 0";
        targetModels = [];
        if (statusDiv) statusDiv.innerText = "확인완료 0 / 0";
        return;
    }

    if (currentOrderIndex >= filteredOrders.length) currentOrderIndex = filteredOrders.length - 1;
    if (currentOrderIndex < 0) currentOrderIndex = 0;

    const currentOrder = filteredOrders[currentOrderIndex];
    targetModels = currentOrder.items.map(p => p.model);

    let htmlContent = `
        <div style="background:#e0f2fe; color:#0369a1; padding:10px 15px; border-radius:6px; margin-bottom:15px; font-weight:bold; display:flex; justify-content:space-between; align-items:center;">
            <span>👷 설치기사: <span style="font-size:16px; color:#0
