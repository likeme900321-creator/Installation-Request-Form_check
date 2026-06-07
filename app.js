// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 5대 중요 데이터 핀포인트 파싱
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
            
            // 💡 PDF 내부 텍스트 조각들을 순수 텍스트만 남기고 정제하여 배열로 만듭니다.
            const textItems = textData.items.map(item => {
                // 줄바꿈, 공백, 따옴표 등 노이즈 제거
                return item.str.replace(/[\r\n\t"']/g, '').trim();
            }).filter(item => item !== "");

            pdfTextContent = textItems.join(" ");

            // [5대 중요 항목 초기 변수]
            let technician = "미확인";
            let orderItems = [];
            targetModels = [];

            // 💡 [완벽 해결] 기사님 이름 자동 추적 로직 (가변 대응)
            // '설치기사' 텍스트 조각을 찾은 후, 그 직후에 등장하는 진짜 사람 이름(2~4자 한글)을 추출합니다.
            for (let i = 0; i < textItems.length; i++) {
                if (textItems[i] === "설치기사") {
                    // '설치기사' 단어 뒤로 최대 5칸까지 탐색
                    for (let j = i + 1; j <= i + 5; j++) {
                        if (textItems[j]) {
                            const nameCandidate = textItems[j];
                            
                            // ❌ '확인', '고객명', '(성명)' 같은 시스템 단어는 패스합니다.
                            if (nameCandidate === "확인" || 
                                nameCandidate.includes("고객") || 
                                nameCandidate.includes("최종") || 
                                nameCandidate.includes("성명") ||
                                nameCandidate.includes("주소")) {
                                continue;
                            }
                            
                            // 🔎 진짜 기사님 이름 조건: 보통 2자~4자 사이의 순수 한글 이름인 경우 확정
                            if (/^[가-힣]{2,4}$/.test(nameCandidate)) {
                                technician = nameCandidate;
                                break;
                            }
                        }
                    }
                    if (technician !== "미확인") break;
                }
            }

            // 💡 [정밀 필터] 표 내부 데이터 매칭 추출 (자재 원천 차단 + 일반 주문만)
            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];

                // 가전 완제품 모델명 패턴 분석 (영어 대문자 + 숫자 조합 형태)
                if (/^[A-Z]{2,4}\d+[A-Z0-9-_.]+/i.test(item)) {
                    
                    const upperItem = item.toUpperCase();

                    // ❌ [자재 차단] P로 시작하는 모델명은 순수 자재이므로 완벽 배제
                    // 단, PQ로 시작하는 모델명(예: PQ060907A01)은 실제 에어컨 완제품이므로 통과
                    if (upperItem.startsWith('P') && !upperItem.startsWith('PQ')) {
                        continue; 
                    }

                    let quantity = "1"; 
                    let orderType = "미확인";
                    let location = "공란(미지정)";

                    // 모델명 발견 지점 이후 영역에서 수량과 원주문구분('일반')을 매칭
                    for (let j = i + 1; j < Math.min(i + 15, textItems.length); j++) {
                        const nextItem = textItems[j];

                        if (nextItem === "일반" || nextItem === "특수") {
                            orderType = nextItem;
                            
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

                    // 💡 오직 원주문구분이 '일반'인 제품만 최종 목록에 등록
                    if (orderType === "일반") {
                        // 모델명 뒤의 유통 코드(.AKOR 등) 제거
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

            // ==========================================
            // 화면 업데이트 (중요도 순서대로 정렬 표시)
            // ==========================================
            if (orderItems.length > 0) {
                // 1순위 설치기사 상단 고정
                let htmlContent = `
                    <li style="list-style:none; margin-bottom:15px; background:#e0e7ff; padding:10px; border-radius:6px; border-left:5px solid #4f46e5;">
                        👷 <b>1. 설치기사 :</b> <span style="font-size:16px; color:#1e1b4b; font-weight:bold;">${technician} 기사님</span>
                    </li>`;
                
                // 2~5순위 제품 상세 내역 렌더링
                orderItems.forEach((prod, index) => {
                    htmlContent += `
                        <li style="margin-bottom: 12px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px; list-style:none;">
                            <b style="color:#4f46e5;">📋 [주문 품목 ${index + 1}]</b><br>
                            • <b>2. 모델명 :</b> <span style="color:#b91c1c; font-weight:bold;">${prod.model}</span><br>
                            • <b>3. 수량 :</b> ${prod.qty} 개<br>
                            • <b>4. 원주문구분 :</b> <span style="background:#fef08a; padding:1px 4px; border-radius:3px;">${prod.type}</span><br>
                            • <b>5. 제품위치 :</b> <span style="color:#64748b;">${prod.loc}</span>
                        </li>`;
                });
                
                orderList.innerHTML = htmlContent;
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                orderList.innerHTML = `
                    <li style="list-style:none; background:#f1f5f9; padding:10px; border-radius:6px;">
                        👷 <b>1. 설치기사 :</b> <span style="font-weight:bold;">${technician}</span><br><br>
                        ⚠️ 검수 대상 제품(원주문구분: 일반)이 없거나 순수 자재 코드만 존재하여 품목이 등록되지 않았습니다.
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
// 2. 사진 촬영 시 자동 글자 읽기 기능 (생략)
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
