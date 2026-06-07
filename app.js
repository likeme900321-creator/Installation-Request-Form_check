// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfDoc = null;          
let currentPdfPage = 1;     
let totalPdfPages = 0;      
let currentPageTargetModels = []; 

// 현재 진행 중인 렌더링 작업을 추적하고 취소하기 위한 전역 변수
let currentRenderTask = null;

document.getElementById("pdfFile").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const pageIndicator = document.getElementById("pageIndicator");
    pageIndicator.innerText = "📄 대량 의뢰서 로딩 및 페이지 분할 중...";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            const loadingTask = pdfjsLib.getDocument({
                data: typedarray,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/cmaps/',
                cMapPacked: true
            });
            
            pdfDoc = await loadingTask.promise;
            totalPdfPages = pdfDoc.numPages; 
            currentPdfPage = 1; 
            
            await loadAndRenderPage(currentPdfPage);

        } catch (error) {
            console.error("PDF 초기 로드 에러:", error);
            alert("⚠️ 의뢰서 파일 구조를 읽지 못했습니다.");
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 🔄 [캔버스 버그 수정] 페이지 전환 및 초기화 연동 함수
// ==========================================
async function loadAndRenderPage(pageNumber) {
    if (!pdfDoc) return;

    // 1. 이전 페이지의 데이터 및 입력창 즉시 초기화
    document.getElementById("manualInput").value = "";
    document.getElementById("ocrResult").innerHTML = "<span style='color: #64748b;'>📸 스티커 바코드 사진을 촬영해 주세요.</span>";
    document.getElementById("status").innerHTML = `<span style="color: #475569; font-weight: bold;">검수 대기</span>`;
    currentPageTargetModels = []; 

    const canvas = document.getElementById("pdfCanvas");
    const ctx = canvas.getContext("2d");
    const pageIndicator = document.getElementById("pageIndicator");
    const orderList = document.getElementById("orderList");

    // 💡 [캔버스 변경 핵심 1] 이전 페이지 렌더링 작업이 아직 실행 중이라면 강제로 취소(메모리 엉킴 방지)
    if (currentRenderTask) {
        currentRenderTask.cancel();
        currentRenderTask = null;
    }

    // 💡 [캔버스 변경 핵심 2] 새 이미지를 그리기 전에 기존 캔버스를 깨끗하게 지우고 초기화
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;

    try {
        const page = await pdfDoc.getPage(pageNumber);
        
        // 스마트폰 화면 너비에 맞춰 scale 자동 조절 (기본 1.5배 선명하게)
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        // 💡 [캔버스 변경 핵심 3] 렌더링 작업을 변수에 할당하여 제어 가능하도록 설정
        currentRenderTask = page.render(renderContext);
        await currentRenderTask.promise;
        currentRenderTask = null; // 작업 완료 후 초기화

        // [텍스트 파싱 및 UI 업데이트]
        const textContent = await page.getTextContent();
        const textItems = textContent.items.map(item => {
            if (!item || !item.str) return "";
            return item.str.replace(/[\r\n\t"']/g, '').trim();
        }).filter(item => item !== "");

        if (textItems.length === 0) return;

        // 설치기사 성명 추출
        let technicianName = "미지정";
        const techIndex = textItems.findIndex(text => text.includes("설치기사"));
        if (techIndex !== -1 && textItems[techIndex + 1]) {
            technicianName = textItems[techIndex + 1].replace(/,/g, '').trim();
        }

        // 고객명 추출
        let customerName = "미확인";
        const customerIndex = textItems.findIndex(text => text.includes("고객명"));
        if (customerIndex !== -1 && textItems[customerIndex + 1]) {
            customerName = textItems[customerIndex + 1].replace(/,/g, '').trim();
        }

        // 품목 추출
        let products = [];
        for (let i = 0; i < textItems.length; i++) {
            let upperText = textItems[i].replace(/,/g, '').trim().toUpperCase();

            if (/^[A-Z0-9._-]+$/i.test(upperText)) {
                if (upperText.startsWith('PQ')) continue; 
                if (upperText.length < 5 || /^\d+$/.test(upperText)) continue;
                if (/^\d+-\d+/.test(upperText)) continue; 

                let quantity = "1";
                let isNormalOrder = false;

                for (let j = Math.max(0, i - 2); j < Math.min(textItems.length, i + 15); j++) {
                    if (textItems[j].includes("일반") || textItems[j].includes("특수")) {
                        isNormalOrder = true;
                        if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1].trim())) quantity = textItems[j-1].trim();
                        else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1].trim())) quantity = textItems[j+1].trim();
                        break;
                    }
                }

                if (isNormalOrder) {
                    let cleanModel = upperText.split('.')[0].trim();
                    products.push({ model: cleanModel, qty: quantity });
                }
            }
        }

        const uniqueProducts = [];
        const seenModels = new Set();
        products.forEach(p => {
            if (!seenModels.has(p.model)) {
                seenModels.add(p.model);
                uniqueProducts.push(p);
            }
        });

        currentPageTargetModels = uniqueProducts.map(p => p.model);

        let htmlContent = `
            <div style="background:#e0f2fe; color:#0369a1; padding:10px; border-radius:6px; margin-bottom:12px; font-weight:bold;">
                👷 담당기사: <span style="font-size:16px; color:#0284c7;">${technicianName}</span> 기사님
            </div>
            <div style="margin-bottom: 10px; font-size:14px; color:#334155;">
                👤 <b>고객명:</b> ${customerName} 고객님
            </div>
            <div style="font-weight:bold; margin-top:15px; margin-bottom:5px; font-size:13px; color:#4f46e5;">[주문 품목 리스트]</div>
        `;

        if
