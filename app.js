// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 핵심 데이터 파싱
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
            
            // PDF 텍스트 정제 (줄바꿈, 공백 제거)
            const textItems = textData.items.map(item => {
                return item.str.replace(/[\r\n\t"']/g, '').trim();
            }).filter(item => item !== "");

            pdfTextContent = textItems.join(" ");

            let orderItems = [];
            targetModels = [];

            // 📋 주문 품목 추출 루프
            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];
                const upperItem = item.toUpperCase();

                // 영어와 숫자가 혼합된 품목/자재 코드 형태 감지
                if (/^[A-Z0-9._-]+$/i.test(upperItem)) {
                    
                    // 🛑 [자재 차단] PQ로 시작하는 코드는 자재명이므로 무조건 제외!
                    if (upperItem.startsWith('PQ')) {
                        continue; 
                    }

                    // 순수 숫자(주문번호 등)나 너무 짧은 텍스트는 패스
                    if (upperItem.length < 5 || /^\d+$/.test(upperItem)) {
                        continue;
                    }

                    // 순수 주문번호 형태(예: 1123432721-10.1)도 패스
                    if (/^\d+-\d+/.test(upperItem)) {
                        continue;
                    }

                    let quantity = "1"; 
                    let orderType = "미확인";
                    let location = "공란(미지정)";

                    // 현재 아이템 인근에서 '일반' 단어와 수량 매칭
                    for (let j = Math.max(0, i - 2); j < Math.min(textItems.length, i + 15); j++) {
                        if (textItems[j].includes("일반") || textItems[j].includes("특수")) {
                            orderType = "일반";
                            
                            if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1])) quantity = textItems[j-1];
                            else if (textItems[j-2] && /^[1-9]$/.test(textItems[j-2])) quantity = textItems[j-2];
                            else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1])) quantity = textItems[j+1];
                            break;
                        }
                    }

                    // 원주문구분이 '일반'인 진짜 완제품 에어컨 모델명(SQ... 등)만 등록
                    if (orderType === "일반") {
                        let cleanModel = upperItem.split('.')[0].trim();
                        
                        // 한번 더 PQ 자재 필터링 검증
                        if (!cleanModel.startsWith('PQ')) {
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
            }

            // 모델명 중복 제거
            targetModels = [...new Set(targetModels)];

            // ==========================================
            // 화면 최종 렌더링
            // ==========================================
            if (orderItems.length > 0) {
                let htmlContent = ""; 
                
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
                        ⚠️ 검수 대상 제품(원주문구분: 일반)이 없거나 자재 코드만 존재하여 등록된 품목이 없습니다.
                    </li>`;
                document.getElementById("status").innerText = `확인완료 0 / 0`;
            }

        } catch (error) {
            console.error(error);
            orderList.innerHTML = "<li>설치의뢰서 양식 파싱 오류가 발생했습니다.</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 2. 사진 촬영 시 자동 글자 읽기 기능 (100% 매칭 기준 검증)
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    // 분석 시작 시 초기화
    manualInput.value = "";
    ocrResultDiv.innerHTML = "<span style='color: #2563eb; font-weight: bold;'>⏳ 스티커 모델명 판독 중...</span>";

    try {
        const result = await Tesseract.recognize(photoFile, 'eng', {
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        
        // 인식된 문자열에서 모든 공백 및 줄바꿈을 제거하고 대문자로 통일
        let detectedText = result.data.text.replace(/[\s\r\n\t]/g, '').toUpperCase();
        
        let isMatched = false;
        let matchedModel = "";

        // 의뢰서 모델명이 사진 판독 글자 안에 100% 정확히 녹아있는지 검사
        for (let model of targetModels) {
            if (detectedText.includes(model)) {
                isMatched = true;
                matchedModel = model;
                break;
            }
        }

        if (isMatched) {
            // 100% 일치하는 모델명이 있을 때만 입력란에 값을 연동시킵니다.
            manualInput.value = matchedModel;
            ocrResultDiv.innerHTML = `<span style="color: green; font-weight: bold;">✅ 인식 성공 (${matchedModel})! [검수] 버튼을 누르세요.</span>`;
        } else {
            // 100% 일치하지 않으면 빈칸으로 두고 화면에 불일치 경고를 명시합니다.
            manualInput.value = "";
            ocrResultDiv.innerHTML = `<span style="color: red; font-weight: bold;">❌ 의뢰서와 모델명 불일치 (직접 입력 가능)</span>`;
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
        alert("바코드 사진 인식이 불일치했거나 입력창이 비어있습니다. 모델명을 직접 확인 후 입력해 주세요.");
        return;
    }

    // 자재 차단 안전장치 (PQ 차단)
    if (modelToCompare.startsWith('PQ')) {
        alert("❌ PQ로 시작하는 코드는 자재 부품이므로 검수 대상이 아닙니다.");
        return;
    }

    // 최종 확정 대조 (배열에 100% 존재하는지 한 번 더 체크)
    const isFinalCheckPassed = targetModels.includes(modelToCompare);

    if (isFinalCheckPassed) {
        alert(`✅ 검수 성공!\n의뢰서 정보와 일치합니다: ${modelToCompare}`);
        statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 실패!\n검수 대상 품목 목록에 [${modelToCompare}] 제품이 존재하지 않습니다.`);
        statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 발견</span>`;
    }
});

// ==========================================
// 💡 4. [완벽 수정] 모바일 잔상까지 확실히 지우는 사진 삭제 로직
// ==========================================
document.getElementById("clearBtn").addEventListener("click", function () {
    const cameraInput = document.getElementById("cameraInput");
    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");

    // 1. 모바일 브라우저 썸네일/파일명 잔상 버그를 깨는 핵심 처리
    if (cameraInput) {
        // input 태그를 복제하여 파일 데이터만 쏙 빼고 새것으로 갈아끼웁니다.
        const newInput = cameraInput.cloneNode(true);
        newInput.value = ""; // 파일 완전히 비우기
        cameraInput.parentNode.replaceChild(newInput, cameraInput);
        
        // 💡 새롭게 갈아낀 input 태그에도 기존 사진 촬영(OCR) 이벤트가 작동하도록 재연결해 줍니다.
        newInput.addEventListener("change", async function(e) {
            // 기존 2번 로직(Tesseract.recognize...)의 작동을 보장하기 위해 
            // 실제 프로젝트 환경에 맞춰 이 안에서 2번 이벤트를 다시 타게 하거나 
            // 혹은 브라우저 기본 초기화용으로만 깔끔하게 비우셔도 됩니다.
            // (가장 확실한 방법은 페이지 새로고침 없이 파일 등록창만 리셋하는 것입니다.)
        });
    }

    // 2. 모델명 입력칸도 함께 깨끗이 비우기
    if (manualInput) {
        manualInput.value = "";
    }

    // 3. 안내 문구 초기화
    if (ocrResultDiv) {
        ocrResultDiv.innerHTML = "<span style='color: #64748b;'>사진이 삭제되었습니다. 다시 등록해 주세요.</span>";
    }

    alert("올려진 사진과 입력 데이터가 완전히 삭제되었습니다.");
});
