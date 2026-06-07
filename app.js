// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 핵심 데이터 파싱 (최초 원본 로직 보완)
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
            
            // 💡 [필수 정제] PDF 내부의 숨겨진 줄바꿈(\n), 쉼표(,), 따옴표 등을 공백으로 치환하고 
            // 쪼개진 단어들을 완벽히 단어 단위로 재정리합니다.
            const textItems = textData.items.map(item => {
                return item.str.replace(/[\r\n\t"',]/g, ' ').trim();
            }).filter(item => item !== "");

            pdfTextContent = textItems.join(" ");

            let technician = "미확인";
            let orderItems = [];
            targetModels = [];

            // 문서 전체 데이터를 순회하며 매칭
            for (let i = 0; i < textItems.length; i++) {
                
                // [설치기사 매칭] '설치기사' 발견 시 기사 이름 정상 추출
                if (textItems[i].includes("설치기사")) {
                    if (textItems[i+1]) {
                        technician = textItems[i+1].split(' ')[0].trim();
                    }
                }

                const item = textItems[i];

                // 💡 [복구 및 강화] 가전 완제품 모델명 패턴 매칭 규칙 (PQ, SQ 등 확장 유연화)
                // 영문 대문자로 시작하고 뒤에 숫자와 영문이 정밀하게 조합된 형태를 서칭합니다.
                if (/^[A-Z]{2,4}\d+[A-Z0-9-_.]+/i.test(item)) {
                    
                    const upperItem = item.toUpperCase();

                    // 🛑 P로 시작하는 모델명은 순수 자재 부품이므로 품목 리스트에서 완벽 배제
                    // 단, PQ로 시작하는 모델명(예: PQ060907A01)은 실제 에어컨 완제품이므로 통과
                    if (upperItem.startsWith('P') && !upperItem.startsWith('PQ')) {
                        continue; 
                    }

                    // 주문서 번호(하이픈 연속 구조) 데이터가 모델명으로 잘못 스킵되는 것 방지
                    if (/^\d+-\d+/.test(upperItem)) {
                        continue;
                    }

                    let quantity = "1"; 
                    let orderType = "미확인";
                    let location = "공란(미지정)";

                    // 모델명 발견 지점 이후 영역에서 수량과 원주문구분('일반')을 추적
                    for (let j = i + 1; j < Math.min(i + 20, textItems.length); j++) {
                        const nextItem = textItems[j];

                        if (nextItem.includes("일반") || nextItem.includes("특수")) {
                            orderType = "일반";
                            
                            // '일반' 단어 주변 앞뒤에 위치한 진짜 수량(숫자) 수집
                            if (textItems[j-1] && /^\d+$/.test(textItems[j-1])) {
                                quantity = textItems[j-1];
                            } else if (textItems[j-2] && /^\d+$/.test(textItems[j-2])) {
                                quantity = textItems[j-2];
                            } else if (textItems[j+1] && /^\d+$/.test(textItems[j+1])) {
                                quantity = textItems[j+1];
                            }
                            break;
                        }
                    }

                    // 원주문구분이 '일반'인 제품을 최종 검수 품목으로 완벽하게 등록
                    if (orderType === "일반") {
                        // 모델명 뒤의 유통 코드(.AKOR 등) 제거하고 순수 모델명만 확보
                        let cleanModel = item.split('.')[0].trim().toUpperCase();
                        
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

            // 모델명 중복 제거
            targetModels = [...new Set(targetModels)];

            // 화면에 파싱 결과 업데이트
            if (orderItems.length > 0) {
                // 상단에 담당 설치기사 정보 노출
                let htmlContent = `
                    <div style="background:#e0e7ff; padding:12px; border-radius:6px; margin-bottom:20px; border-left:5px solid #4f46e5;">
                        👷 <b>담당 설치기사 :</b> <span style="color:#4f46e5; font-weight:bold; font-size:16px;">${technician}</span> 기사님
                    </div>`;
                
                // 지정된 중요도 순서대로 제품 상세 내역 렌더링
                orderItems.forEach((prod, index) => {
                    htmlContent += `
                        <li style="margin-bottom: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; list-style:none;">
                            <b style="color:#4f46e5; font-size:15px;">📋 [주문 품목 ${index + 1}]</b><br><br>
                            • <b>1. 설치기사 :</b> ${technician}<br>
                            • <b>2. 모델명 :</b> <span style="color:#b91c1c; font-weight:bold; font-size:16px;">${prod.model}</span><br>
                            • <b>3. 수량 :</b> <span style="font-weight:bold;">${prod.qty}</span> 개<br>
                            • <b>4. 원주문구분 :</b> <span style="background:#fef08a; padding:1px 4px; border-radius:3px; font-weight:bold;">${prod.type}</span><br>
                            • <b>5. 제품위치 :</b> <span style="color:#64748b;">${prod.loc}</span>
                        </li>`;
                });
                
                orderList.innerHTML = htmlContent;
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                orderList.innerHTML = `
                    <li style="list-style:none; background:#f1f5f9; padding:15px; border-radius:6px; color:#475569;">
                        ⚠️ 검수 대상 제품(원주문구분: 일반)이 없거나 순수 자재 코드만 존재하여 등록된 품목이 없습니다.
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
// 2. 사진 촬영 시 자동 글자 읽기 기능 (OCR)
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    manualInput.value = "";
    ocrResultDiv.innerText = "⏳ 스티커 일련번호 판독 중...";

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
        alert("모델명을 입력하거나 사진을 등록하세요.");
        return;
    }

    if (modelToCompare.startsWith('P') && !modelToCompare.startsWith('PQ')) {
        alert("❌ 해당 코드는 자재 부품이므로 검수 대상이 아닙니다.");
        return;
    }

    const isMatched = targetModels.includes(modelToCompare);

    if (isMatched) {
        alert(`✅ 검수 성공!\n의뢰서 정보와 일치합니다: ${modelToCompare}`);
        statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 실패!\n검수 대상 품목 목록에 [${modelToCompare}] 제품이 존재하지 않습니다.`);
        statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 발견</span>`;
    }
});
