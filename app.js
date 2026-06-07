// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// 대량 멀티 의뢰서 관리를 위한 전역 마스터 상태 변수
let allOrders = [];         // PDF에서 추출한 의뢰서 전체 목록
let filteredOrders = [];    // 검색어가 적용된 의뢰서 목록
let targetModels = [];      // 현재 화면에 띄워진 의뢰서의 완제품 모델명 대조군

let currentOrderIndex = 0;  // 현재 화면에 보여지고 있는 의뢰서의 번호 (0부터 시작)

// ==========================================
// 1. [완벽 수정] 대용량 변환 PDF 전용 초경량·고안정성 파싱 로직
// ==========================================
document.getElementById("pdfFile").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li style='list-style:none; color:#2563eb; font-weight:bold;'>📄 대량 설치의뢰서 최적화 분석 중... (데이터 정밀 로딩 중)</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            // 💡 [핵심 변경] 대용량 문서 로딩 시 브라우저가 멈추는 것을 막기 위해 비동기 타스크 매니저 설정
            const loadingTask = pdfjsLib.getDocument({
                data: typedarray,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/cmaps/', // 한글 깨짐 방지용 맵핑 추가
                cMapPacked: true
            });
            
            const pdf = await loadingTask.promise;
            const totalPdfPages = pdf.numPages; 
            
            allOrders = []; // 마스터 데이터 초기화

            // 각 페이지를 순차적으로 완벽하게 분할 압축 파싱
            for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
                try {
                    const page = await pdf.getPage(pageNum);
                    const textData = await page.getTextContent();
                    
                    // CrystalViewer 특유의 따옴표 및 컴마 기호 완벽 정제
                    const textItems = textData.items.map(item => {
                        if (!item || !item.str) return "";
                        return item.str.replace(/[\r\n\t"']/g, '').trim();
                    }).filter(item => item !== "");

                    if (textItems.length === 0) continue;

                    // 🕵️‍♂️ 해당 페이지의 [설치기사] 찾기 (공백 및 특수문자 제거 정밀 매칭)
                    let technicianName = "미지정";
                    const techIndex = textItems.findIndex(text => text.includes("설치기사"));
                    if (techIndex !== -1 && textItems[techIndex + 1]) {
                        technicianName = textItems[techIndex + 1].replace(/\s+/g, '');
                    }

                    // 🕵️‍♂️ 해당 페이지의 [고객명] 찾기
                    let customerName = "미확인";
                    const customerIndex = textItems.findIndex(text => text.includes("고객명"));
                    if (customerIndex !== -1 && textItems[customerIndex + 1]) {
                        customerName = textItems[customerIndex + 1].replace(/\s+/g, '');
                    }

                    let products = [];

                    // 📋 품목 추출 루프
                    for (let i = 0; i < textItems.length; i++) {
                        const item = textItems[i];
                        const upperItem = item.toUpperCase();

                        // 모델명 및 자재 코드 정규식 스캔
                        if (/^[A-Z0-9._-]+$/i.test(upperItem)) {
                            if (upperItem.startsWith('PQ')) continue; // 자재 부품 코드 제외
                            if (upperItem.length < 5 || /^\d+$/.test(upperItem)) continue;
                            if (/^\d+-\d+/.test(upperItem)) continue;

                            let quantity = "1";
                            let orderType = "미확인";

                            // 주변 텍스트 환경 탐색 ('일반' 배차 수량 확인)
                            for (let j = Math.max(0, i - 2); j < Math.min(textItems.length, i + 15); j++) {
                                if (textItems[j].includes("일반") || textItems[j].includes("특수")) {
                                    orderType = "일반";
                                    if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1])) quantity = textItems[j-1];
                                    else if (textItems[j-2] && /^[1-9]$/.test(textItems[j-2])) quantity = textItems[j-2];
                                    else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1])) quantity = textItems[j+1];
                                    break;
                                }
                            }

                            // 진짜 완제품 에어컨 모델명만 수집
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

                    // 정상적인 품목이 하나라도 있는 의뢰서 세트만 적재
                    if (uniqueProducts.length > 0) {
                        allOrders.push({
                            pdfPage: pageNum,
                            technician: technicianName,
                            customer: customerName,
                            items: uniqueProducts
                        });
                    }
                } catch (pageError) {
                    console.error(`${pageNum}페이지 파싱 중 건너뜀:`, pageError);
                    continue; // 오류 페이지가 발생해도 다음 페이지로 스무스하게 패스
                }
            }

            // 분석 종료 후 복사 및 첫 페이지 활성화
            filteredOrders = [...allOrders];
            currentOrderIndex = 0;
            
            // 화면 렌더링 호출
            renderCurrentOrder();

        } catch (error) {
            console.error("전체 PDF 로딩 오류:", error);
            orderList.innerHTML = `
                <li style='color:red; list-style:none; line-height: 1.5;'>
                    ⚠️ 대량 의뢰서 처리 중 브라우저 제한에 걸렸습니다.<br>
                    스마트폰 성능에 따라 한 번에 80장을 읽을 때 과부하가 올 수 있으니,<br>
                    지속해서 오류 발생 시 의뢰서 PDF 파일을 2~3개로 나누어(분할 발행) 올려주시면 완전히 해결됩니다.
                </li>`;
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
            <span>👷 설치기사: <span style="font-size:16px; color:#0284c7;">${currentOrder.technician}</span> 기사님</span>
            <span style="font-size:12px; background:white; padding:2px 6px; border-radius:4px; color:#64748b;">PDF ${currentOrder.pdfPage} 쪽</span>
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
                • <b>수량:</b> <span style="font-weight:bold; color:#1e293b;">${prod.qty}</span> 개
            </div>
        `;
    });

    orderList.innerHTML = htmlContent;

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
        alert("첫 번째 설치의뢰서입니다.");
    }
});

document.getElementById("nextPageBtn").addEventListener("click", function () {
    if (currentOrderIndex < filteredOrders.length - 1) {
        currentOrderIndex++;
        renderCurrentOrder();
    } else {
        alert("마지막 설치의뢰서입니다.");
    }
});

// ==========================================
// 🔍 기사님 이름 단위 검색/필터 기능
// ==========================================
function performTechnicianSearch() {
    const searchInput = document.getElementById("searchTechnician");
    const keyword = searchInput.value.trim().replace(/\s+/g, '').toUpperCase();

    if (keyword === "") {
        filteredOrders = [...allOrders];
    } else {
        filteredOrders = allOrders.filter(order => order.technician.toUpperCase().includes(keyword));
    }

    currentOrderIndex = 0; 
    renderCurrentOrder();
}

document.getElementById("searchBtn").addEventListener("click", performTechnicianSearch);
document.getElementById("searchTechnician").addEventListener("keyup", function (e) {
    if (e.key === "Enter") performTechnicianSearch();
});

document.getElementById("searchResetBtn").addEventListener("click", function () {
    document.getElementById("searchTechnician").value = "";
    filteredOrders = [...allOrders];
    currentOrderIndex = 0;
    renderCurrentOrder();
});

// ==========================================
// 2. 바코드 사진 촬영 판독 (현재 띄워진 페이지 대조)
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    manualInput.value = "";
    ocrResultDiv.innerHTML = "<span style='color: #2563eb; font-weight: bold;'>⏳ 현재 의뢰서 스티커 분석 중...</span>";

    try {
        const result = await Tesseract.recognize(photoFile, 'eng', {
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        
        let detectedText = result.data.text.replace(/[\s\r\n\t]/g, '').toUpperCase();
        
        let isMatched = false;
        let matchedModel = "";

        for (let model of targetModels) {
            if (detectedText.includes(model)) {
                isMatched = true;
                matchedModel = model;
                break;
            }
        }

        if (isMatched) {
            manualInput.value = matchedModel;
            ocrResultDiv.innerHTML = `<span style="color: green; font-weight: bold;">✅ 일치 제품 확인 (${matchedModel})! 검수를 완료하세요.</span>`;
        } else {
            manualInput.value = "";
            ocrResultDiv.innerHTML = `<span style="color: red; font-weight: bold;">❌ 현재 의뢰서 기사 배정 품목에 없는 모델명입니다.</span>`;
        }

    } catch (err) {
        console.error(err);
        ocrResultDiv.innerHTML = "<span style='color: red;'>사진 스캔 실패 (수동 입력 가능)</span>";
    }
});

// ==========================================
// 3. 검수 버튼 클릭 (최종 확정)
// ==========================================
document.getElementById("checkBtn").addEventListener("click", function () {
    const manualInput = document.getElementById("manualInput");
    const statusDiv = document.getElementById("status");
    const modelToCompare = manualInput.value.trim().toUpperCase();

    if (modelToCompare === "") {
        alert("모델명을 직접 확인 후 입력해 주세요.");
        return;
    }

    if (modelToCompare.startsWith('PQ')) {
        alert("❌ PQ로 시작하는 코드는 자재 부품이므로 검수 대상이 아닙니다.");
        return;
    }

    const isFinalCheckPassed = targetModels.includes(modelToCompare);

    if (isFinalCheckPassed) {
        alert(`✅ 검수 완료!\n현재 화면의 의뢰서 정보와 일치합니다: ${modelToCompare}`);
        if (statusDiv) statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 불일치!\n현재 활성화된 페이지 목록에는 [${modelToCompare}] 제품이 없습니다.`);
        if (statusDiv) statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 식별됨</span>`;
    }
});
