<script>
        // PDF.js 워커 엔진 설정
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

        let pdfDoc = null;          
        let currentPdfPage = 1;     
        let totalPdfPages = 0;      
        let currentPageTargetModels = []; 
        let currentRenderTask = null;

        // [1] 파일 선택 시 최초 동작 구동
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
                    alert("⚠️ 의뢰서 파일 구조를 읽지 못했습니다. 캐시를 삭제하고 다시 시도해 주세요.");
                }
            };
            fileReader.readAsArrayBuffer(file);
        });

        // [2] 🔄 딱 1페이지만 실시간 연동하여 표출하는 핵심 마스터 로직
        async function loadAndRenderPage(pageNumber) {
            if (!pdfDoc) return;

            // 새 페이지 열 때 입력창 및 결과창 깨끗하게 밀어버리기
            document.getElementById("manualInput").value = "";
            document.getElementById("ocrResult").innerHTML = "<span style='color: #64748b;'>📸 스티커 바코드 사진을 촬영해 주세요.</span>";
            document.getElementById("status").innerHTML = `<span style="color: #475569; font-weight: bold;">검수 대기</span>`;
            currentPageTargetModels = []; 

            const canvas = document.getElementById("pdfCanvas");
            const ctx = canvas.getContext("2d");
            const pageIndicator = document.getElementById("pageIndicator");
            const orderList = document.getElementById("orderList");

            // 이전 페이지 그리던 작업이 덜 끝났다면 강제 취소해서 충돌 차단
            if (currentRenderTask) {
                currentRenderTask.cancel();
                currentRenderTask = null;
            }

            // 캔버스 도화지 깨끗하게 밀어버리기
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.width = 0;
            canvas.height = 0;

            try {
                const page = await pdfDoc.getPage(pageNumber);
                
                // 모바일 최적화 선명도 비율 조절
                const viewport = page.getViewport({ scale: 1.5 });
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext = {
                    canvasContext: ctx,
                    viewport: viewport
                };
                
                currentRenderTask = page.render(renderContext);
                await currentRenderTask.promise;
                currentRenderTask = null; 

                // 텍스트 추출 및 노이즈 기호 삭제
                const textContent = await page.getTextContent();
                const textItems = textContent.items.map(item => {
                    if (!item || !item.str) return "";
                    return item.str.replace(/[\r\n\t"']/g, '').trim();
                }).filter(item => item !== "");

                if (textItems.length === 0) return;

                // 기사명 추출
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

                // 품목 모델명 정밀 스캔
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

                // 화면 글씨 뿌리기
                let htmlContent = `
                    <div style="background:#e0f2fe; color:#0369a1; padding:10px; border-radius:6px; margin-bottom:12px; font-weight:bold;">
                        👷 담당기사: <span style="font-size:16px; color:#0284c7;">${technicianName}</span> 기사님
                    </div>
                    <div style="margin-bottom: 10px; font-size:14px; color:#334155;">
                        👤 <b>고객명:</b> ${customerName} 고객님
                    </div>
                    <div style="font-weight:bold; margin-top:15px; margin-bottom:5px; font-size:13px; color:#4f46e5;">[주문 품목 리스트]</div>
                `;

                if (uniqueProducts.length === 0) {
                    htmlContent += `<div style="color:#64748b; font-size:13px; padding:10px; background:#f1f5f9; border-radius:6px;">배정된 일반 완제품 품목이 없습니다.</div>`;
                } else {
                    uniqueProducts.forEach((prod, idx) => {
                        htmlContent += `
                            <div style="margin-bottom: 8px; border:1px solid #e2e8f0; padding:10px; border-radius:6px; background:white;">
                                • <b>모델 ${idx + 1}:</b> <span style="color:#b91c1c; font-weight:bold;">${prod.model}</span> 
                                <span style="float:right; color:#1e293b; font-weight:bold;">${prod.qty} 개</span>
                            </div>
                        `;
                    });
                }
                orderList.innerHTML = htmlContent;
                pageIndicator.innerText = `의뢰서 건수: ${pageNumber} / ${totalPdfPages} 장`;

            } catch (err) {
                if (err.name === 'RenderingCancelledException') {
                    console.log('이전 페이지 렌더링 정상 취소 완료');
                } else {
                    console.error("페이지 로딩 실패:", err);
                    pageIndicator.innerText = `⚠️ ${pageNumber}페이지 로딩 중 에러 발생`;
                }
            }
        }

        // [3] 이전장 버튼 핸들러
        document.getElementById("prevPageBtn").addEventListener("click", async function () {
            if (!pdfDoc) return;
            if (currentPdfPage > 1) {
                currentPdfPage--;
                await loadAndRenderPage(currentPdfPage);
            } else {
                alert("첫 번째 의뢰서 페이지입니다.");
            }
        });

        // [4] 다음장 버튼 핸들러
        document.getElementById("nextPageBtn").addEventListener("click", async function () {
            if (!pdfDoc) return;
            if (currentPdfPage < totalPdfPages) {
                currentPdfPage++;
                await loadAndRenderPage(currentPdfPage);
            } else {
                alert("마지막 의뢰서 페이지입니다.");
            }
        });

        // [5] 스티커 바코드 인식 처리 기법
        document.getElementById("cameraInput").addEventListener("change", async function (e) {
            const photoFile = e.target.files[0];
            if (!photoFile) return;

            const manualInput = document.getElementById("manualInput");
            const ocrResultDiv = document.getElementById("ocrResult");
            
            manualInput.value = "";
            ocrResultDiv.innerHTML = "<span style='color: #2563eb; font-weight: bold;'>⏳ 현재 켜진 페이지 정보와 비교 분석 중...</span>";

            try {
                const result = await Tesseract.recognize(photoFile, 'eng', {
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
                });
                
                let detectedText = result.data.text.replace(/[\s\r\n\t]/g, '').toUpperCase();
                let isMatched = false;
                let matchedModel = "";

                for (let model of currentPageTargetModels) {
                    if (detectedText.includes(model)) {
                        isMatched = true;
                        matchedModel = model;
                        break;
                    }
                }

                if (isMatched) {
                    manualInput.value = matchedModel;
                    ocrResultDiv.innerHTML = `<span style="color: green; font-weight: bold;">✅ 현재 의뢰서와 일치 (${matchedModel})! 검수를 확정하세요.</span>`;
                } else {
                    manualInput.value = "";
                    ocrResultDiv.innerHTML = `<span style="color: red; font-weight: bold;">❌ 현재 화면(기사님 품목)에 없는 제품 바코드입니다.</span>`;
                }

            } catch (err) {
                console.error(err);
                ocrResultDiv.innerHTML = "<span style='color: red;'>사진 인식 실패 (수동 입력 가능)</span>";
            }
        });

        // [6] 최종 검수 버튼 동작
        document.getElementById("checkBtn").addEventListener("click", function () {
            const manualInput = document.getElementById("manualInput");
            const statusDiv = document.getElementById("status");
            const modelToCompare = manualInput.value.trim().toUpperCase();

            if (modelToCompare === "") {
                alert("모델명을 직접 입력하거나 사진을 다시 찍어주세요.");
                return;
            }

            const isFinalCheckPassed = currentPageTargetModels.includes(modelToCompare);

            if (isFinalCheckPassed) {
                alert(`✅ 검수 성공!\n현재 화면의 자재가 맞습니다: ${modelToCompare}`);
                statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">일치 확인완료 (${modelToCompare})</span>`;
            } else {
                alert(`❌ 검수 불일치!\n현재 활성화된 기사님 품목 리스트에는 [${modelToCompare}]가 없습니다.`);
                statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">⚠️ 미일치 제품 스캔됨</span>`;
            }
        });
    </script>
