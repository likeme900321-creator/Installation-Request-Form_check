// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// 대량 멀티 의뢰서 관리를 위한 전역 마스터 상태 변수
let allOrders = [];         // PDF에서 추출한 의뢰서 전체 목록 (1장 = 1개 객체)
let filteredOrders = [];    // 검색어가 적용된 의뢰서 목록
let targetModels = [];      // 현재 화면에 표시된 완제품 모델명 대조군

let currentOrderIndex = 0;  // 현재 화면에서 보고 있는 의뢰서 번호 (0부터 시작)

// ==========================================
// 1. [오류 완벽 해결] CrystalViewer PDF 전용 정밀 파싱 로직
// ==========================================
document.getElementById("pdfFile").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li style='list-style:none; color:#2563eb; font-weight:bold;'>📄 대량 의뢰서 구조 분석 및 데이터 정제 중... 잠시만 기다려 주세요.</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            // 한글 및 기호 유실 방지를 위한 파일 로딩
            const loadingTask = pdfjsLib.getDocument({
                data: typedarray,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/cmaps/',
                cMapPacked: true
            });
            
            const pdf = await loadingTask.promise;
            const totalPdfPages = pdf.numPages; // 전체 PDF 페이지 수
            
            allOrders = []; // 데이터 초기화

            // 🔄 각 페이지를 돌면서 노이즈를 제거하고 순수 데이터만 추출
            for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
                try {
                    const page = await pdf.getPage(pageNum);
                    const textData = await page.getTextContent();
                    
                    // 💡 [핵심 버그 수정] \n, \r, \t, 큰따옴표, 쉼표 등 매칭을 방해하는 모든 노이즈 제거
                    const rawItems = textData.items.map(item => {
                        if (!item || !item.str) return "";
                        return item.str.replace(/[\r\n\t"']/g, '').trim();
                    });

                    // 공백 배열 제거 및 순수 텍스트 배열 완성
                    const textItems = rawItems.filter(item => item !== "");
                    if (textItems.length === 0) continue;

                    // 🕵️‍♂️ 1. 통합 텍스트 매칭으로 [설치기사] 찾기
                    let technicianName = "미지정";
                    const techIndex = textItems.findIndex(text => text.includes("설치기사"));
                    if (techIndex !== -1 && textItems[techIndex + 1]) {
                        // 쉼표 찌꺼기 제거 후 기사명 획득
                        technicianName = textItems[techIndex + 1].replace(/,/g, '').trim();
                    }

                    // 🕵️‍♂️ 2. 통합 텍스트 매칭으로 [고객명] 찾기
                    let customerName = "미확인";
                    const customerIndex = textItems.findIndex(text => text.includes("고객명"));
                    if (customerIndex !== -1 && textItems[customerIndex + 1]) {
                        customerName = textItems[customerIndex + 1].replace(/,/g, '').trim();
                    }

                    let products = [];

                    // 📋 3. 모델명과 수량 패턴 정밀 스캔
                    // 주문서 항목 뒤에 나오는 데이터를 추적
                    for (let i = 0; i < textItems.length; i++) {
                        let currentText = textItems[i].replace(/,/g, '').trim();
                        let upperText = currentText.toUpperCase();

                        // 영문+숫자 혼합 형태의 필터링 (에어컨 모델명 양식 타겟팅)
                        if (/^[A-Z0-9._-]+$/i.test(upperText)) {
                            
                            // 🛑 불필요 자재 코드(PQ), 날짜 형식(20260608), 짧은 번호(1, 2) 제외
                            if (upperText.startsWith('PQ')) continue;
                            if (upperText.length < 5 || /^\d+$/.test(upperText)) continue;
                            if (/^\d+-\d+/.test(upperText)) continue; // 주문서번호 차단

                            let quantity = "1";
                            let isNormalOrder = false;

                            // 모델명 주변 15개 텍스트 범위를 뒤져서 수량과 배차 타입("일반") 체크
                            for (let j = Math.max(0, i - 2); j < Math.min(textItems.length, i + 15); j++) {
                                let checkTarget = textItems[j];
                                if (checkTarget.includes("일반") || checkTarget.includes("특수")) {
                                    isNormalOrder = true;
                                    
                                    // 바로 앞이나 뒤에 있는 1~9 사이의 순수 숫자를 수량으로 판단
                                    if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1].trim())) {
                                        quantity = textItems[j-1].trim();
                                    } else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1].trim())) {
                                        quantity = textItems[j+1].trim();
                                    }
                                    break;
                                }
                            }

                            // 실물 에어컨 완제품 모델명 최종 바인딩
                            if (isNormalOrder) {
                                let cleanModel = upperText.split('.')[0].trim();
                                products.push({
                                    model: cleanModel,
                                    qty: quantity
                                });
                            }
                        }
                    }

                    // 한 의뢰서 안에서 중복으로 긁힌 모델명 병합 처리
                    const uniqueProducts = [];
                    const seenModels = new Set();
                    products.forEach(p => {
                        if (!seenModels.has(p.model)) {
                            seenModels.add(p.model);
                            uniqueProducts.push(p);
                        }
                    });

                    // 완제품 정보가 정상 추출된 페이지망 의뢰서 배열에 독립 추가
                    if (uniqueProducts.length > 0) {
                        allOrders.push({
                            pdfPage: pageNum,
                            technician: technicianName,
                            customer: customerName,
                            items: uniqueProducts
                        });
                    }
                } catch (pageError) {
                    console.error(`${pageNum}페이지 파싱 중 스킵:`, pageError);
                    continue; // 에러가 나는 페이지는 조용히 넘어가서 전체 시스템이 멈추지 않게 함
                }
            }

            // 마스터 배열을 화면 필터 배열로 복사하고 첫 번째 장 활성화
            filteredOrders = [...allOrders];
            currentOrderIndex = 0;
            
            // 화면에 1장 출력
            renderCurrentOrder();

        } catch (error) {
            console.error("PDF 파싱 전체 에러:", error);
            orderList.innerHTML = "<li style='color:red; list-style:none;'>⚠️ PDF 의뢰서 구조를 읽는 데 실패했습니다. 파일 양식을 다시 확인해 주세요.</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 🔄 현재 인덱스의 "딱 1장" 의뢰서만 화면에 표출하는 함수
// ==========================================
function renderCurrentOrder() {
    const orderList = document.getElementById("orderList");
    const pageIndicator = document.getElementById("pageIndicator");
    const statusDiv = document.getElementById("status");

    if (filteredOrders.length === 0) {
        orderList.innerHTML = `<li style="list-style:none; background:#f1f5f9; padding:15px; border-radius:6px; color:#475569; text-align:center;">⚠️ 검색 조건에 맞는 기사님이나 의뢰서 내역이 없습니다.</li>`;
        pageIndicator.innerText = "의뢰서 건수: 0 / 0";
        targetModels = [];
        if (statusDiv) statusDiv.innerText = "확인완료 0 / 0";
        return;
    }

    // 인덱스 안전 가드레일
    if (currentOrderIndex >= filteredOrders.length) currentOrderIndex = filteredOrders.length - 1;
    if (currentOrderIndex < 0) currentOrderIndex = 0;

    // 현재 화면에 띄울 정확히 1장의 데이터만 선택
    const currentOrder = filteredOrders[currentOrderIndex];
    
    // 카메라 인식 시 비교 타겟이 될 모델명 동기화
    targetModels = currentOrder.items.map(p => p.model);

    // HTML UI 생성
    let htmlContent = `
        <div style="background:#e0f2fe; color:#0369a1; padding:12px; border-radius:6px; margin-bottom:15px; font-weight:bold; display:flex; justify-content:space-between; align-items:center;">
            <span>👷 담당기사: <span style="font-size:16px; color:#0284c7;">${currentOrder.technician}</span> 기사님</span>
            <span style="font-size:12px; background:white; padding:2px 6px; border-radius:4px; color:#64748b;">PDF ${currentOrder.pdfPage} 쪽</span>
        </div>
        <div style="margin-bottom: 12px; font-size:14px; color:#334155; padding-left:5px;">
            👤 <b>고객명:</b> ${currentOrder.customer} 고객님
        </div>
    `;

    currentOrder.items.forEach((prod, idx) => {
        htmlContent += `
            <div style="margin-bottom: 10px; border:1px solid #e2e8f0; padding:12px; border-radius:6px; background:white; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                <b style="color:#4f46e5; font-size:13px;">[품목 ${idx + 1}]</b><br>
                <div style="margin-top:5px;">
                    • <b>모델명:</b> <span style="color:#b91c1c; font-weight:bold; font-size:15px;">${prod.model}</span><br>
                    • <b>배정수량:</b> <span style="font-weight:bold; color:#1e293b;">${prod.qty}</span> 개
                </div>
            </div>
        `;
    });

    orderList.innerHTML = htmlContent;

    // 하단 페이징 글씨 동기화 (예: 의뢰서 건수: 1 / 80)
    pageIndicator.innerText = `의뢰서 건수: ${currentOrderIndex + 1} / ${filteredOrders.length}`;
    if (statusDiv) statusDiv.innerHTML = `<span style="color: #475569; font-weight: bold;">현재 장 검수 대기 0 / ${targetModels.length}</span>`;
}

// ==========================================
// ◀ ▶ [페이지 이동 버튼] 앞장, 뒷장 제어 핸들러
// ==========================================
document.getElementById("prevPageBtn").addEventListener("click", function () {
    if (currentOrderIndex > 0) {
        currentOrderIndex--;
        renderCurrentOrder(); // 앞장으로 넘어가며 다시 1장 렌더링
    } else {
        alert("첫 번째 설치의뢰서 페이지입니다.");
    }
});

document.getElementById("nextPageBtn").addEventListener("click", function () {
    if (currentOrderIndex < filteredOrders.length - 1) {
        currentOrderIndex++;
        renderCurrentOrder(); // 뒷장으로 넘어가며 다시 1장 렌더링
    } else {
        alert("마지막 설치의뢰서 페이지입니다.");
    }
});

// ==========================================
// 🔍 기사님 이름 검색 및 필터 리셋 기능
// ==========================================
function performTechnicianSearch() {
    const searchInput = document.getElementById("searchTechnician");
    const keyword = searchInput.value.trim().replace(/\s+/g, '').toUpperCase();

    if (keyword === "") {
        filteredOrders = [...allOrders];
    } else {
        filteredOrders = allOrders.filter(order => order.technician.toUpperCase().includes(keyword));
    }

    currentOrderIndex = 0; // 기사 검색 시 발견된 첫 장으로 즉시 복귀
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
// 2. 바코드 사진 촬영 판독 (오직 현재 화면에 열린 1장하고만 크로스 체크)
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    manualInput.value = "";
    ocrResultDiv.innerHTML = "<span style='color: #2563eb; font-weight: bold;'>⏳ 바코드 스티커 대조 중...</span>";

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
            ocrResultDiv.innerHTML = `<span style="color: green; font-weight: bold;">✅ 일치 제품 확인 (${matchedModel})! 검수를 확정하세요.</span>`;
        } else {
            manualInput.value = "";
            ocrResultDiv.innerHTML = `<span style="color: red; font-weight: bold;">❌ 현재 기사님 품목에 없는 모델명입니다.</span>`;
        }

    } catch (err) {
        console.error(err);
        ocrResultDiv.innerHTML = "<span style='color: red;'>사진 스캔 실패 (수동 입력 가능)</span>";
    }
});

// ==========================================
// 3. 검수 버튼 클릭 (최종 검증 완료)
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
        alert(`✅ 검수 완료!\n현재 화면의 의뢰서 정보와 완벽히 매칭됩니다: ${modelToCompare}`);
        if (statusDiv) statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 불일치!\n현재 화면에 표시된 리스트에는 [${modelToCompare}] 제품이 없습니다. 기사님 이름이나 앞뒤 페이지를 다시 확인해 주세요.`);
        if (statusDiv) statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 식별됨</span>`;
    }
});
