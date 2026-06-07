// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// 💡 대량 데이터 처리를 위한 전역 상태 변수들
let allOrderItems = [];       // PDF에서 추출한 전체 주문 데이터 배열
let filteredOrderItems = [];  // 검색 필터가 적용된 주문 데이터 배열
let targetModels = [];        // 현재 화면(현재 페이지)에 표시된 완제품 모델명 대조군

let currentPage = 1;          // 현재 보고 있는 페이지 번호
const ITEMS_PER_PAGE = 5;     // 한 페이지에 보여줄 주문 의뢰서 개수 (원하는 대로 조절 가능)

// ==========================================
// 1. 대량 PDF 로드 및 전체 페이지 텍스트 파싱
// ==========================================
document.getElementById("pdfFile").addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li>📄 대량 의뢰서 분석 중... 수십 장의 경우 시간이 수 초 걸릴 수 있습니다.</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const totalPdfPages = pdf.numPages; // 대량 PDF의 전체 페이지 수 
            
            allOrderItems = []; // 데이터 초기화
            
            // 🔄 80장 조회를 위해 전체 PDF 페이지를 루프 돌며 데이터 수집
            for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textData = await page.getTextContent();
                
                const textItems = textData.items.map(item => {
                    return item.str.replace(/[\r\n\t"']/g, '').trim();
                }).filter(item => item !== "");

                // 💡 [기사님 이름 추출 로직 추가] 
                // 의뢰서 텍스트 중 '설치기사' 단어 바로 다음에 오는 단어를 기사 이름으로 추출합니다.
                let technicianName = "미지정기사";
                const techIndex = textItems.findIndex(text => text.includes("설치기사"));
                if (techIndex !== -1 && textItems[techIndex + 1]) {
                    technicianName = textItems[techIndex + 1].replace(/\s+/g, '');
                }

                // 📋 해당 페이지 내에서 주문 품목 추출 루프
                for (let i = 0; i < textItems.length; i++) {
                    const item = textItems[i];
                    const upperItem = item.toUpperCase();

                    if (/^[A-Z0-9._-]+$/i.test(upperItem)) {
                        
                        // [자재 차단] PQ 코드는 제외
                        if (upperItem.startsWith('PQ')) continue; 
                        if (upperItem.length < 5 || /^\d+$/.test(upperItem)) continue;
                        if (/^\d+-\d+/.test(upperItem)) continue;

                        let quantity = "1"; 
                        let orderType = "미확인";
                        let location = "공란(미지정)";

                        for (let j = Math.max(0, i - 2); j < Math.min(textItems.length, i + 15); j++) {
                            if (textItems[j].includes("일반") || textItems[j].includes("특수")) {
                                orderType = "일반";
                                if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1])) quantity = textItems[j-1];
                                else if (textItems[j-2] && /^[1-9]$/.test(textItems[j-2])) quantity = textItems[j-2];
                                else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1])) quantity = textItems[j+1];
                                break;
                            }
                        }

                        if (orderType === "일반") {
                            let cleanModel = upperItem.split('.')[0].trim();
                            if (!cleanModel.startsWith('PQ')) {
                                // 전체 마스터 배열에 기사 정보와 함께 push
                                allOrderItems.push({
                                    technician: technicianName, // 🔍 기사 이름 매핑
                                    model: cleanModel,
                                    qty: quantity,
                                    type: orderType,
                                    loc: location,
                                    pdfPage: pageNum // 원본 페이지 정보 기록
                                });
                            }
                        }
                    }
                }
            }

            // 초기 로드 시에는 전체 데이터를 필터 데이터에 대입
            filteredOrderItems = [...allOrderItems];
            currentPage = 1;
            
            // 화면 렌더링 호출
            renderPagedList();

        } catch (error) {
            console.error(error);
            orderList.innerHTML = "<li>의뢰서 대량 파싱 중 오류가 발생했습니다.</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 🔄 핵심: 페이징 및 필터링 기준 화면 렌더링 함수
// ==========================================
function renderPagedList() {
    const orderList = document.getElementById("orderList");
    const pageIndicator = document.getElementById("pageIndicator");
    
    if (filteredOrderItems.length === 0) {
        orderList.innerHTML = `<li style="list-style:none; background:#f1f5f9; padding:15px; border-radius:6px; color:#475569;">⚠️ 조건에 일치하는 의뢰서 내역이 없습니다.</li>`;
        pageIndicator.innerText = "페이지: 0 / 0";
        targetModels = [];
        document.getElementById("status").innerText = `확인완료 0 / 0`;
        return;
    }

    // 전체 필요한 페이지 수 계산
    const totalPages = Math.ceil(filteredOrderItems.length / ITEMS_PER_PAGE);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    // 현재 페이지 데이터 쪼개기 (Slice)
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const pageItems = filteredOrderItems.slice(startIndex, endIndex);

    // 💡 중요: 현재 눈에 보이는 페이지의 모델명들만 진짜 대조군(targetModels)으로 세팅!
    targetModels = [...new Set(pageItems.map(item => item.model))];

    // HTML 출력물 생성
    let htmlContent = "";
    pageItems.forEach((prod, index) => {
        const globalIndex = startIndex + index + 1;
        htmlContent += `
            <li style="margin-bottom: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; list-style:none;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <b style="color:#4f46e5; font-size:15px;">📋 [의뢰 품목 ${globalIndex}] (원본 PDF ${prod.pdfPage}쪽)</b>
                    <span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:20px; font-size:12px; font-weight:bold;">👷 담당기사: ${prod.technician}</span>
                </div>
                <br>
                • <b>1. 모델명 :</b> <span style="color:#b91c1c; font-weight:bold; font-size:16px;">${prod.model}</span><br>
                • <b>2. 수량 :</b> <span style="font-weight:bold;">${prod.qty}</span> 개<br>
                • <b>3. 원주문구분 :</b> <span style="background:#fef08a; padding:1px 4px; border-radius:3px; font-weight:bold;">${prod.type}</span>
            </li>`;
    });

    orderList.innerHTML = htmlContent;
    
    // 페이지 번호 UI 업데이트
    pageIndicator.innerText = `페이지: ${currentPage} / ${totalPages} (총 ${filteredOrderItems.length}건)`;
    document.getElementById("status").innerText = `현재 페이지 검수 대기 0 / ${targetModels.length}`;
}

// ==========================================
// ◀ ▶ 이전 / 다음 페이지 이동 이벤트 제어
// ==========================================
document.getElementById("prevPageBtn").addEventListener("click", function() {
    if (currentPage > 1) {
        currentPage--;
        renderPagedList();
    }
});

document.getElementById("nextPageBtn").addEventListener("click", function() {
    const totalPages = Math.ceil(filteredOrderItems.length / ITEMS_PER_PAGE);
    if (currentPage < totalPages) {
        currentPage++;
        renderPagedList();
    }
});

// ==========================================
// 🔍 기사님 이름 검색 및 필터링 기능
// ==========================================
function handleSearch() {
    const keyword = document.getElementById("searchTechnician").value.trim().toUpperCase();
    
    if (keyword === "") {
        filteredOrderItems = [...allOrderItems];
    } else {
        // 기사 이름에 검색어가 포함되어 있는지 100% 매칭 및 포함 검사
        filteredOrderItems = allOrderItems.filter(item => item.technician.toUpperCase().includes(keyword));
    }
    
    currentPage = 1; // 검색 시 첫 페이지로 리셋
    renderPagedList();
}

document.getElementById("searchBtn").addEventListener("click", handleSearch);
// 엔터키 검색 연동
document.getElementById("searchTechnician").addEventListener("keyup", function(e) {
    if (e.key === "Enter") handleSearch();
});

// 검색 초기화 버튼
document.getElementById("searchResetBtn").addEventListener("click", function() {
    document.getElementById("searchTechnician").value = "";
    filteredOrderItems = [...allOrderItems];
    currentPage = 1;
    renderPagedList();
});

// ==========================================
// 2. 사진 촬영 시 자동 글자 읽기 기능 (100% 매칭 기준 검증)
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    manualInput.value = "";
    ocrResultDiv.innerHTML = "<span style='color: #2563eb; font-weight: bold;'>⏳ 스티커 바코드 판독 중...</span>";

    try {
        const result = await Tesseract.recognize(photoFile, 'eng', {
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        
        let detectedText = result.data.text.replace(/[\s\r\n\t]/g, '').toUpperCase();
        
        let isMatched = false;
        let matchedModel = "";

        // 💡 현재 활성화된 페이지에 떠있는 모델명들과만 사진 매칭 진행
        for (let model of targetModels) {
            if (detectedText.includes(model)) {
                isMatched = true;
                matchedModel = model;
                break;
            }
        }

        if (isMatched) {
            manualInput.value = matchedModel;
            ocrResultDiv.innerHTML = `<span style="color: green; font-weight: bold;">✅ 인식 성공 (${matchedModel})! [검수] 버튼을 누르세요.</span>`;
        } else {
            manualInput.value = "";
            ocrResultDiv.innerHTML = `<span style="color: red; font-weight: bold;">❌ 현재 페이지 의뢰서와 모델명 불일치</span>`;
        }

    } catch (err) {
        console.error(err);
        ocrResultDiv.innerHTML = "<span style='color: red;'>사진 인식 실패 (모델명 수동 입력 검수 가능)</span>";
    }
});

// ==========================================
// 3. 검수 버튼 클릭 (최종 매칭)
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
        alert(`✅ 검수 성공!\n현재 페이지 정보와 일치합니다: ${modelToCompare}`);
        statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 실패!\n현재 화면 목록에 [${modelToCompare}] 제품이 존재하지 않습니다. 페이지 번호나 기사 검색 필터를 확인하세요.`);
        statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 발견</span>`;
    }
});
