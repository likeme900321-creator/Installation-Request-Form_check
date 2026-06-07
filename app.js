// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 조건부 필터링 (자재 제외 / 일반 주문만)
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
            
            // 💡 PDF 내부 줄바꿈이나 띄어쓰기 매칭을 위해 원본 데이터 정리
            const items = textData.items.map(item => item.str.trim());
            pdfTextContent = items.join(" ");

            // 💡 [필터링 로직] 원주문 구분이 '일반'인 행의 모델명만 찾아내기
            // 현장 PDF 구조에 맞춰 유연하게 매칭하기 위해 모델명 규칙 적용
            const modelPattern = /[A-Z0-9]{5,15}/g; 
            let foundModels = [];

            // PDF 텍스트 내에서 '일반'이라는 단어가 근처에 있는 모델명 위주로 1차 수집하거나,
            // 전체 텍스트에서 'P'로 시작하는 자재 코드를 제외합니다.
            const allPossibleMatches = pdfTextContent.match(modelPattern) || [];
            
            // 💡 'P'로 시작하는 자재 제외 & 너무 짧거나 긴 노이즈 텍스트 필터링
            foundModels = allPossibleMatches.filter(model => {
                const isMaterial = model.startsWith('P'); // P로 시작하는 자재인가?
                return !isMaterial && model.length >= 6;
            });

            // 💡 '일반' 주문 검증 (의뢰서 전체에 '일반'이라는 계약 구분이 있는지 체크)
            // 만약 의뢰서 자체에 '일반' 텍스트가 없다면 주의 메시지 표시
            const isGeneralOrder = pdfTextContent.includes("일반");

            if (!isGeneralOrder) {
                orderList.innerHTML = "<li>⚠️ '일반' 주문 구분이 아닙니다. 검수 대상이 아닙니다.</li>";
                document.getElementById("status").innerText = `확인완료 0 / 0`;
                targetModels = [];
                return;
            }

            targetModels = [...new Set(foundModels)];

            if (targetModels.length > 0) {
                orderList.innerHTML = targetModels.map(m => `<li>📦 검수 대상 모델: <b>${m}</b></li>`).join("");
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                orderList.innerHTML = "<li>검수 대상 모델명이 없습니다. (자재 제외됨)</li>";
                document.getElementById("status").innerText = `확인완료 0 / 0`;
            }
        } catch (error) {
            orderList.innerHTML = "<li>PDF 로드 오류</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 2. 사진 촬영 시 자동 글자 읽기 기능 분리 (비동기 처리)
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    manualInput.value = "";
    ocrResultDiv.innerText = "⏳ 사진 인식 중... (완료될 때까지 잠시 기다려주세요)";

    try {
        // 이미지를 읽는 동안 사용자가 기다리지 않도록 비동기 실행
        const result = await Tesseract.recognize(photoFile, 'eng', {
            // 자재 제외 및 속도업을 위해 영어 대문자/숫자만 타겟팅
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        
        const detectedText = result.data.text.replace(/\s+/g, '');
        ocrResultDiv.innerText = "인식 완료! 검수 버튼을 눌러주세요.";

        // 사진에서 가져온 글자 중 PDF에 존재하는 모델명이 있다면 인풋창에 미리 넣어줌
        for (let model of targetModels) {
            if (detectedText.includes(model)) {
                manualInput.value = model;
                break;
            }
        }
    } catch (err) {
        ocrResultDiv.innerText = "사진 인식 실패 (모델명을 직접 입력 후 검수 가능)";
    }
});

// ==========================================
// 3. 검수 버튼 클릭 (0.1초 만에 매칭 완료)
// ==========================================
document.getElementById("checkBtn").addEventListener("click", function () {
    const manualInput = document.getElementById("manualInput");
    const statusDiv = document.getElementById("status");
    const modelToCompare = manualInput.value.trim();

    if (modelToCompare === "") {
        alert("인식된 모델명이 없거나 입력되지 않았습니다. 사진 판독이 끝날 때까지 기다리거나 직접 입력해 주세요.");
        return;
    }

    // P로 시작하는 자재를 수동으로 입력했을 때 한 번 더 차단
    if (modelToCompare.startsWith('P')) {
        alert("❌ 자재(P로 시작)는 검수 대상이 아닙니다.");
        return;
    }

    // 비교 대조 (0.1초)
    const isMatched = targetModels.includes(modelToCompare) || pdfTextContent.replace(/\s+/g, '').includes(modelToCompare);

    if (isMatched) {
        alert(`✅ 검수 성공!\n일치하는 제품입니다: ${modelToCompare}`);
        statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 실패!\n설치의뢰서 목록에 [${modelToCompare}] 제품이 없습니다.`);
        statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 발견</span>`;
    }
});
