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
                
                // 💡 [핵심 해결책] 쪼개진 단어들을 매칭하기 쉽게 전체 줄바꿈/기호를 다 지운 통짜 문자열로 병합
                let fullText = textContent.items.map(item => item.str || "").join(" ");
                // 정제: 큰따옴표, 따옴표 제거 및 공백 정렬
                fullText = fullText.replace(/[\r\n\t"']/g, " ").trim();

                // 🕵️‍♂️ 통짜 문자열에서 기사명 추출 (설치기사 문구 바로 뒤 단어 매칭)
                let technicianName = "미지정";
                const techMatch = fullText.match(/설치기사\s+([가-힣]{2,4})/);
                if (techMatch && techMatch[1]) {
                    technicianName = techMatch[1];
                }

                // 🕵️‍♂️ 통짜 문자열에서 고객명 추출 (고객명 문구 바로 뒤 단어 매칭)
                let customerName = "미확인";
                const customerMatch = fullText.match(/고객명\s+([가-힣]{2,4})/);
                if (customerMatch && customerMatch[1]) {
                    customerName = customerMatch[1];
                }

                // 📋 [품목 추출 대수술] 에어컨 모델명 정규식 패턴 자동 스캔 
                // 조건: 영문 대문자와 숫자가 섞여있고 최소 6글자 이상인 단어 추출
                const words = fullText.split(/\s+/);
                let uniqueProducts = [];
                let seenModels = new Set();

                for (let word of words) {
                    let cleanWord = word.replace(/,/g, '').trim().toUpperCase();
                    
                    // 에어컨 완제품 모델명 패턴 분석 (알파벳+숫자 혼합, 자재부품 PQ 제외, 길이 제한)
                    if (/^[A-Z0-9.-]+$/.test(cleanWord) && cleanWord.length >= 6) {
                        if (cleanWord.startsWith('PQ')) continue;           // 부품 제외
                        if (/^\d+$/.test(cleanWord)) continue;               // 순수 숫자 제외
                        if (cleanWord.includes('202606')) continue;         // 날짜 제외
                        if (cleanWord.startsWith('010-')) continue;          // 전화번호 제외
                        if (cleanWord.includes('112343')) continue;         // 주문서번호 패턴 제외

                        // 마침표나 확장자 찌꺼기가 붙어있다면 제거
                        let finalModel = cleanWord.split('.')[0].trim();

                        if (!seenModels.has(finalModel)) {
                            seenModels.add(finalModel);
                            
                            // 기본 수량은 우선 1개로 세팅 (수량 컬럼이 찢어져 있어서 완제품 모델명 자체를 타겟팅)
                            uniqueProducts.push({
                                model: finalModel,
                                qty: "1"
                            });
                        }
                    }
                }

                currentPageTargetModels = uniqueProducts.map(p => p.model);

                // 화면 우측/하단 UI 글씨 뿌리기
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
                                • <b>모델 ${idx + 1}:</b> <span style="color:#b91c1c; font-weight:bold; font-size:15px;">${prod.model}</span> 
                                <span style="float:right; color:#1e293b; font-weight:bold;">${prod.qty} 개</span>
                            </div>
                        `;
                    });
                }
                orderList.innerHTML = htmlContent;
                pageIndicator.innerText = `의뢰서 건수: ${pageNumber} / ${totalPdfPages} 장`;
                document.getElementById("status").innerHTML = `<span style="color: #2563eb; font-weight: bold;">현재 페이지 검수 대기 (품목: ${currentPageTargetModels.length}개)</span>`;

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
