// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 중요도 기반 정밀 파싱
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
            // 텍스트 조각들을 순서대로 배열화
            const textItems = textData.items.map(item => item.str.trim());
            pdfTextContent = textItems.join(" ");

            // [중요 데이터 추출 변수]
            let technician = "미확인";
            let orderItems = [];
            targetModels = [];

            // 1단계: 설치기사 찾기 (중요도 1순위)
            for (let i = 0; i < textItems.length; i++) {
                if (textItems[i].includes("설치기사")) {
                    if (textItems[i+1]) technician = textItems[i+1];
                    break;
                }
            }

            // 2~5단계: 표(Table) 내부 데이터 추출 (모델명, 수량, 제품위치, 원주문구분)
            // '원주문구분'이 '일반'인 행만 필터링하여 수집합니다.
            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];

                // 에어컨/가전 모델명 형태 패턴 (PQ, SQ 등 대문자+숫자 조합)
                if (/^[A-Z]{2,4}\d+[A-Z0-9-_]+/i.test(item)) {
                    
                    // 순수 자재 부품 코드 차단 (PQ는 통과, 그 외 P로 시작하는 자재는 제외)
                    if (item.toUpperCase().startsWith('P') && !item.toUpperCase().startsWith('PQ')) {
                        continue; 
                    }

                    // 모델명 기준으로 주변 데이터(수량, 제품위치, 원주문구분) 추적
                    let quantity = "미확인";
                    let location = "미지정";
                    let orderType = "미확인";

                    // 테이블 구조상 모델명 뒤에 수량(보통 숫자 1~2자리), 제품위치, 원주문구분이 순서대로 배치됨
                    // 최대 6칸 뒤까지 탐색하여 정보를 매칭
                    for (let j = i + 1; j < Math.min(i + 7, textItems.length); j++) {
                        if (textItems[j] === "일반" || textItems[j] === "특수") {
                            orderType = textItems[j];
                            // '일반' 단어가 나온 위치 기준으로 앞뒤 수량 및 위치 재정렬 가능
                            if (textItems[j-2] && /^\d+$/.test(textItems[j-2])) {
                                quantity = textItems[j-2];
                            }
                            break;
                        }
                    }

                    // 💡 조건: '원주문구분'이 '일반'인 제품만 주문품목 리스트에 추가
                    if (orderType === "일반") {
                        let cleanModel = item.split('.')[0].trim().toUpperCase(); // .AKOR 등 유통코드 제거
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

            // 중복 모델 제거
            targetModels = [...new Set(targetModels)];

            // [화면 표시 엘리먼트 업데이트]
            if (orderItems.length > 0) {
                let htmlContent = `<li style="list-style:none; margin-bottom:10px; background:#eef2f7; padding:8px; border-radius:5px;">👷 <b>설치기사:</b> ${technician}</li>`;
                
                orderItems.forEach((prod, index) => {
                    htmlContent += `
                        <li style="margin-bottom: 8px; border-bottom: 1px dashed #ddd; padding-bottom: 5px;">
                            🔎 [품목 ${index + 1}]<br>
                            • <b>모델명:</b> <span style="color:#4f46e5;">${prod.model}</span><br>
                            • <b>수량:</b> ${prod.qty}개<br>
                            • <b>원주문구분:</b> ${prod.type}<br>
                            • <b>제품위치:</b> ${prod.loc}
                        </li>`;
                });
                
                orderList.innerHTML = htmlContent;
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                orderList.innerHTML = `<li>👷 <b>설치기사:</b> ${technician}<br>⚠️ 검수 대상(원주문구분: 일반) 제품이 없습니다.</li>`;
                document.getElementById("status").innerText = `확인완료 0 / 0`;
            }

        } catch (error) {
            console.error(error);
            orderList.innerHTML = "<li>설치의뢰서 파싱 중 오류가 발생했습니다.</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 2. 사진 촬영 시 자동 글자 읽기 기능 (대문자 통일)
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    manualInput.value = "";
    ocrResultDiv.innerText = "⏳ 스티커 바코드 판독 중... (잠시만 기다려주세요)";

    try {
        const result = await Tesseract.recognize(photoFile, 'eng', {
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        
        const detectedText = result.data.text.replace(/\s+/g, '').toUpperCase();
        ocrResultDiv.innerText = "인식 완료! [검수] 버튼을 눌러주세요.";

        for (let model of targetModels) {
            if (detectedText.includes(model)) {
                manualInput.value = model;
                break;
            }
        }
    } catch (err) {
        ocrResultDiv.innerText = "사진 인식 실패 (모델명 수동 입력 검수 가능)";
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
        alert("인식되거나 입력된 모델명이 없습니다.");
        return;
    }

    if (modelToCompare.startsWith('P') && !modelToCompare.startsWith('PQ')) {
        alert("❌ 자재 부품은 검수 대상이 아닙니다.");
        return;
    }

    const isMatched = targetModels.includes(modelToCompare);

    if (isMatched) {
        alert(`✅ 검수 성공!\n의뢰서 정보와 일치합니다: ${modelToCompare}`);
        statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 실패!\n검수 대상 품목에 [${modelToCompare}] 제품이 없거나 일반 주문이 아닙니다.`);
        statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 발견</span>`;
    }
});
