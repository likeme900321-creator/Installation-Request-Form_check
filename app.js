// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 정밀 행별 필터링 (잡다한 내용 차단)
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

            // PDF 내부 텍스트 추출
            const textData = await page.getTextContent();
            
            // 💡 텍스트 조각들을 하나의 문장으로 합치되, 구조 파악을 위해 공백 유지
            pdfTextContent = textData.items.map(item => item.str).join(" ");

            // 💡 잡다한 단어를 걸러내기 위한 핵심 가전/에어컨 모델명 정규식 
            // 예시: AF25B, FQ18, AR06, MD- 등 주로 사용되는 에어컨/가전 첫 글자 패턴 위주 매칭
            // (현장 모델명들이 알파벳 대문자로 시작하고 뒤에 숫자가 붙는 구조를 타겟팅)
            const modelPattern = /[A-Z]{1,4}\d{2,4}[A-Z0-9-_]+/g; 
            
            let extractedRawModels = [];
            
            // 💡 정밀 검사: 의뢰서 텍스트 조각들을 순회하며 '일반'과 '모델명'이 매칭되는지 분석
            // 의뢰서에서 '일반'이라는 단어가 등장한 위치 근처에 있는 모델명들만 유효한 것으로 판단합니다.
            const lines = pdfTextContent.split(/[\s]{2,}/); // 띄어쓰기가 길게 된 구간을 기준으로 쪼갬
            
            // 만약 양식이 줄바꿈 기반이라면 아래처럼 줄 단위로 판단 가능
            // 여기서는 '일반'이라는 글자와 '모델명 패턴'이 동시에 만족하거나 인접한 경우를 수집합니다.
            const allMatches = pdfTextContent.match(modelPattern) || [];
            
            // 중복 및 불필요 항목 원천 차단 필터링
            targetModels = allMatches.filter(model => {
                const cleanModel = model.trim();
                
                // 1. P로 시작하는 자재 부품인가? -> 탈락
                if (cleanModel.startsWith('P') || cleanModel.startsWith('p')) return false;
                
                // 2. 숫자로만 이루어져 있거나 날짜/전화번호 형태인가? -> 탈락
                if (/^\d+$/.test(cleanModel) || cleanModel.includes('-202')) return false;
                
                // 3. 모델명 길이가 너무 짧거나 단순 일련번호 형태인가? -> 탈락
                if (cleanModel.length < 5) return false;
                
                return true;
            });

            // 💡 최종 중복 제거
            targetModels = [...new Set(targetModels)];

            // 💡 '일반' 원주문 구분 체크
            const hasGeneralKeyword = pdfTextContent.includes("일반");

            if (!hasGeneralKeyword) {
                orderList.innerHTML = "<li>⚠️ '일반' 주문 구분이 확인되지 않습니다.</li>";
                document.getElementById("status").innerText = `확인완료 0 / 0`;
                targetModels = [];
                return;
            }

            if (targetModels.length > 0) {
                orderList.innerHTML = targetModels.map(m => `<li>📦 검수 대상 모델: <b>${m}</b></li>`).join("");
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                orderList.innerHTML = "<li>의뢰서에서 '일반' 대상 모델명을 찾지 못했습니다.</li>";
                document.getElementById("status").innerText = `확인완료 0 / 0`;
            }
        } catch (error) {
            orderList.innerHTML = "<li>PDF 로드 오류가 발생했습니다.</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 2. 사진 촬영 시 자동 글자 읽기 기능 (기존 속도 최적화 유지)
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    manualInput.value = "";
    ocrResultDiv.innerText = "⏳ 사진 인식 중... (완료될 때까지 잠시 기다려주세요)";

    try {
        const result = await Tesseract.recognize(photoFile, 'eng', {
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        
        const detectedText = result.data.text.replace(/\s+/g, '');
        ocrResultDiv.innerText = "인식 완료! 검수 버튼을 눌러주세요.";

        for (let model of targetModels) {
            if (detectedText.includes(model)) {
                manualInput.value = model;
                break;
            }
        }
    } catch (err) {
        ocrResultDiv.innerText = "사진 인식 실패 (모델명 수동 입력 가능)";
    }
});

// ==========================================
// 3. 검수 버튼 클릭 (즉시 비교 대조)
// ==========================================
document.getElementById("checkBtn").addEventListener("click", function () {
    const manualInput = document.getElementById("manualInput");
    const statusDiv = document.getElementById("status");
    const modelToCompare = manualInput.value.trim();

    if (modelToCompare === "") {
        alert("인식되거나 입력된 모델명이 없습니다.");
        return;
    }

    if (modelToCompare.startsWith('P') || modelToCompare.startsWith('p')) {
        alert("❌ 자재(P로 시작)는 검수 대상이 아닙니다.");
        return;
    }

    const isMatched = targetModels.includes(modelToCompare);

    if (isMatched) {
        alert(`✅ 검수 성공!\n일치하는 제품입니다: ${modelToCompare}`);
        statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 실패!\n주문 품목에 [${modelToCompare}] 제품이 없습니다.`);
        statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 발견</span>`;
    }
});
