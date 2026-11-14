"use strict";

window.RecoveryLog = window.RecoveryLog || {};

RecoveryLog.App = (() => {
    const C = RecoveryLog.Calc;
    const D = RecoveryLog.Data;
    const T = RecoveryLog.TradeImport;
    const main = document.getElementById("main");

    let view = "delivery";
    let selectedDate = C.today();
    let selectedMonth = C.today().slice(0, 7);
    let dirty = false;
    let busy = false;
    let ready = false;
    let toastTimer = null;
    let importedTrades = null;

    const e = value => String(value ?? "").replace(
        /[&<>"']/g,
        character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]
    );

    function toast(message) {
        const element = document.getElementById("toast");

        element.textContent = message;
        element.hidden = false;

        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            element.hidden = true;
        }, 5500);
    }

    function report(error) {
        console.error(error);
        toast(error.message || "처리하지 못했습니다.");
    }

    function canLeave() {
        return !dirty || window.confirm(
            "저장하지 않은 입력이 있습니다. 저장하지 않고 이동할까요?"
        );
    }

    function markDirty() {
        dirty = true;
        document.getElementById("save-status").textContent = "입력 중 · 저장 필요";
    }

    function markSaved() {
        dirty = false;
        renderSyncBadge();
    }

    function renderSyncBadge() {
        const badge = document.getElementById("save-status");

        if (dirty) {
            badge.textContent = "입력 중 · 저장 필요";
            badge.title = "현재 입력은 아직 저장하지 않았습니다.";
            return;
        }

        const status = D.getSyncState();

        const labels = {
            local: "브라우저 준비됨",
            syncing: "GitHub 동기화 중",
            ok: "GitHub 동기화됨",
            pending: "이 기기에만 저장",
            error: "동기화 실패 · 로컬 유지"
        };

        badge.textContent = labels[status] || "브라우저 저장";
        badge.title = D.getSyncMessage() || "";
    }

    function notifySync(result, savedMessage = "") {
        renderSyncBadge();

        if (result.ok) {
            toast(
                savedMessage
                    ? savedMessage + " GitHub에도 반영했습니다."
                    : "GitHub 최신 기록을 반영했습니다."
            );
        } else {
            toast(
                (savedMessage ? savedMessage + "\n" : "") +
                "이 기기의 기록은 유지됩니다.\n" +
                result.reason
            );
        }
    }

    async function saveAndSync(savedMessage) {
        render();

        const request = D.sync();

        renderSyncBadge();

        const result = await request;

        render();
        notifySync(result, savedMessage);

        return result;
    }

    async function run(task) {
        if (busy) {
            return;
        }

        busy = true;
        main.inert = true;

        const controls = Array.from(
            document.querySelectorAll("button, input, select, textarea")
        ).filter(element => !element.disabled);

        controls.forEach(element => {
            element.disabled = true;
        });

        try {
            await task();
        } catch (error) {
            report(error);
        } finally {
            controls.forEach(element => {
                if (element.isConnected) {
                    element.disabled = false;
                }
            });

            main.inert = false;
            busy = false;
            renderSyncBadge();
        }
    }

    function metric(label, value, extra = "") {
        return (
            `<div class="metric ${extra}">` +
                `<span>${e(label)}</span>` +
                `<strong>${e(value)}</strong>` +
            "</div>"
        );
    }

    function line(label, value, className = "") {
        return (
            '<div class="summary-line">' +
                `<span>${e(label)}</span>` +
                `<strong class="${className}">${e(value)}</strong>` +
            "</div>"
        );
    }

    function moneyField(name, label, value, placeholder = "미입력") {
        return (
            '<label class="field">' +
                `<span>${e(label)}</span>` +
                `<input class="money" name="${name}" type="text" ` +
                    'inputmode="numeric" autocomplete="off" ' +
                    `placeholder="${e(placeholder)}" value="${e(value ?? "")}">` +
            "</label>"
        );
    }

    function dateBar() {
        return (
            '<div class="datebar">' +
                '<button type="button" class="button secondary" ' +
                    'data-action="previous-date" aria-label="전날">◀</button>' +
                `<input id="record-date" type="date" aria-label="기록 날짜" ` +
                    `min="1900-01-01" max="${C.today()}" ` +
                    `value="${selectedDate}">` +
                '<button type="button" class="button secondary" ' +
                    'data-action="next-date" aria-label="다음날"' +
                    (selectedDate >= C.today() ? " disabled" : "") +
                    ">▶</button>" +
                '<button type="button" class="button secondary small" ' +
                    'data-action="today">오늘</button>' +
            "</div>"
        );
    }

    function overview() {
        const state = D.get();
        const total = C.totals(state);
        const loss = state.settings.lossWon;

        if (loss === null) {
            return (
                '<section class="panel">' +
                    "<h2>시작 손실을 먼저 설정하세요</h2>" +
                    '<p class="hint">기존 기록과 분리된 새 프로젝트입니다. ' +
                        "시작 손실은 원화로 입력합니다.</p>" +
                    '<div class="actions"><button class="button" ' +
                        'data-view="settings">시작 손실 설정</button></div>' +
                "</section>"
            );
        }

        const remaining = loss - total.recovered;
        const percent = loss === 0
            ? 100
            : Math.max(0, Math.min(100, total.recovered / loss * 100));

        return (
            '<section class="panel">' +
                "<h2>전체 회복 현황</h2>" +
                '<div class="grid">' +
                    metric("배달로 쌓은 금액", C.won(total.delivery), "main") +
                    metric(
                        remaining > 0 ? "남은 손실" : "회복 목표 달성",
                        C.won(Math.max(0, remaining)),
                        "main"
                    ) +
                "</div>" +
                line("그 외 수입 누계", C.won(total.other)) +
                line(
                    "트레이딩 순손익",
                    C.won(total.trading),
                    total.trading < 0 ? "negative" : "positive"
                ) +
                line("리베이트", C.won(total.rebate)) +
                line("통합 회복액", C.won(total.recovered)) +
                line("시작 손실", C.won(loss)) +
                (remaining < 0
                    ? line("목표 초과 금액", C.won(-remaining), "positive")
                    : "") +
                `<progress max="100" value="${percent}" ` +
                    'aria-label="회복 진행률"></progress>' +
                `<p class="hint">회복률 ${percent.toFixed(1)}% · ` +
                    "수입·손익 기준이며 비용과 실제 상환 여부는 반영하지 않습니다.</p>" +
            "</section>"
        );
    }

    function deliveryView() {
        const state = D.get();
        const record = state.deliveries[selectedDate];
        const mode = record?.mode || "combined";
        const plan = state.settings.plan;
        const month = C.totals(state, selectedDate.slice(0, 7));
        const total = C.totals(state);

        main.innerHTML =
            '<section class="panel">' +
                "<h2>오늘 수입</h2>" +
                dateBar() +
                '<form id="delivery-form" class="stack">' +
                    '<fieldset class="income-modes">' +
                        "<legend>배달 수입 입력 방식</legend>" +
                        '<div class="mode-options">' +
                            "<label>" +
                                '<input type="radio" name="incomeMode" value="combined"' +
                                    (mode === "combined" ? " checked" : "") +
                                ">합산 입력</label>" +
                            "<label>" +
                                '<input type="radio" name="incomeMode" value="detail"' +
                                    (mode === "detail" ? " checked" : "") +
                                ">쿠팡·배민 상세 입력</label>" +
                        "</div>" +
                    "</fieldset>" +

                    '<div id="combined-income-fields"' +
                        (mode === "combined" ? "" : " hidden") +
                    ">" +
                        moneyField(
                            "combined",
                            "배달 합산 수입 · 원",
                            record?.combined
                        ) +
                    "</div>" +

                    '<div id="detail-income-fields" class="grid"' +
                        (mode === "detail" ? "" : " hidden") +
                    ">" +
                        moneyField("coupang", "쿠팡 수입 · 원", record?.coupang) +
                        moneyField("baemin", "배민 수입 · 원", record?.baemin) +
                    "</div>" +

                    '<p class="hint">선택한 방식의 금액만 저장·합산합니다. ' +
                        "입력 방식을 바꿔도 금액을 자동으로 옮기지는 않습니다.</p>" +

                    '<div class="metric main">' +
                        "<span>이 날짜 배달 합계</span>" +
                        '<strong id="delivery-preview">0원</strong>' +
                    "</div>" +

                    '<div id="daily-target"></div>' +

                    '<div class="other-income">' +
                        moneyField(
                            "other",
                            "그 외 수입 · 원, 선택",
                            record?.other,
                            "다른 일로 번 금액"
                        ) +
                        '<p class="hint">배달 외 수입입니다. 전체 회복액에는 포함하고 ' +
                            "배달 합계와 배달 평균에서는 제외합니다.</p>" +
                    "</div>" +

                    '<div class="metric">' +
                        "<span>이 날짜 배달 + 그 외 수입</span>" +
                        '<strong id="income-preview">0원</strong>' +
                    "</div>" +

                    '<label class="field"><span>메모 · 선택</span>' +
                        `<textarea name="note" maxlength="2000">${e(record?.note || "")}</textarea>` +
                    "</label>" +

                    '<p class="hint">빈칸은 미입력, 0은 수입 없음입니다. ' +
                        "배달 없이 그 외 수입만 저장할 수도 있습니다.</p>" +

                    '<div class="actions">' +
                        '<button class="button" type="submit">수입 저장</button>' +
                        (record
                            ? '<button class="button danger" type="button" ' +
                                'data-action="delete-delivery">이 날짜 수입 삭제</button>'
                            : "") +
                    "</div>" +
                "</form>" +
            "</section>" +

            '<section class="panel">' +
                `<h2>${e(selectedDate.slice(0, 7))} 수입</h2>` +
                '<div class="grid">' +
                    metric("이번 달 배달 수익", C.won(month.delivery), "main") +
                    metric("이번 달 그 외 수입", C.won(month.other)) +
                    metric("전체 배달 수익", C.won(total.delivery)) +
                    metric("전체 그 외 수입", C.won(total.other)) +
                "</div>" +
                `<p class="hint">선택한 하루 배달 목표: ${C.won(plan.daily)} · 주 7일</p>` +
                '<div class="actions"><button class="button secondary" ' +
                    'data-view="plan">예상 완료일과 목표 보기</button></div>' +
            "</section>" +

            overview();

        updateDeliveryPreview();
    }

    function readDelivery() {
        const form = document.getElementById("delivery-form");
        const mode = form.elements.incomeMode.value;

        return {
            mode,
            coupang: mode === "detail"
                ? C.optionalWon(form.elements.coupang.value)
                : null,
            baemin: mode === "detail"
                ? C.optionalWon(form.elements.baemin.value)
                : null,
            combined: mode === "combined"
                ? C.optionalWon(form.elements.combined.value)
                : null,
            other: C.optionalWon(form.elements.other.value),
            note: form.elements.note.value.trim()
        };
    }

    function updateDeliveryPreview() {
        const amount = document.getElementById("delivery-preview");
        const income = document.getElementById("income-preview");
        const target = document.getElementById("daily-target");

        if (!amount || !income || !target) {
            return;
        }

        const form = document.getElementById("delivery-form");
        const mode = form.elements.incomeMode.value;

        document.getElementById("combined-income-fields").hidden =
            mode !== "combined";

        document.getElementById("detail-income-fields").hidden =
            mode !== "detail";

        try {
            const record = readDelivery();
            const sum = C.deliveryAmount(record);
            const other = record.other ?? 0;
            const goal = D.get().settings.plan.daily;

            amount.textContent = C.won(sum);
            income.textContent = C.won(C.safe(sum + other));

            target.innerHTML =
                line("하루 배달 목표 · 주 7일", C.won(goal)) +
                line(
                    sum >= goal ? "배달 목표 초과" : "배달 목표까지",
                    C.won(Math.abs(goal - sum)),
                    sum >= goal ? "positive" : ""
                ) +
                '<p class="hint">그 외 수입은 배달 목표 달성액에는 넣지 않고 ' +
                    "전체 회복액에 별도로 더합니다.</p>";
        } catch (error) {
            amount.textContent = "금액 확인";
            income.textContent = "금액 확인";
            target.innerHTML =
                `<p class="negative">${e(error.message)}</p>`;
        }
    }

    function tradingRow(position = {}) {
        const pnl = position.pnlCents === undefined
            ? ""
            : (position.pnlCents / 100).toFixed(2);

        return (
            `<tr data-ticket="${e(position.ticket || "")}">` +
                '<td><input class="symbol" data-field="symbol" list="symbols" ' +
                    'aria-label="종목" maxlength="80" ' +
                    `value="${e(position.symbol || "")}" placeholder="예: XAUUSD"></td>` +
                '<td><select data-field="side" aria-label="방향">' +
                    `<option value="Buy"${position.side !== "Sell" ? " selected" : ""}>Buy</option>` +
                    `<option value="Sell"${position.side === "Sell" ? " selected" : ""}>Sell</option>` +
                "</select></td>" +
                '<td><input class="lots" data-field="lots" type="text" ' +
                    'inputmode="decimal" aria-label="랏수" ' +
                    `value="${e(position.lots ?? "")}"></td>` +
                '<td><input class="pnl" data-field="pnl" type="text" ' +
                    'inputmode="decimal" aria-label="손익 USD" ' +
                    `value="${e(pnl)}" placeholder="손실은 음수"></td>` +
                '<td><button type="button" class="button danger small" ' +
                    'data-action="remove-position">삭제</button></td>' +
            "</tr>"
        );
    }

    function tradingView() {
        const state = D.get();
        const record = state.trading[selectedDate];
        const previousRates = Object.keys(state.trading).sort().reverse();
        const suggestedRate = record?.rate ??
            (previousRates.length ? state.trading[previousRates[0]].rate : "");

        const symbols = Array.from(new Set(
            Object.values(state.trading).flatMap(item =>
                item.positions.map(position => position.symbol)
            )
        )).sort();

        importedTrades = null;

        main.innerHTML =
            '<section class="panel">' +
                "<h2>트레이딩 기록</h2>" +
                dateBar() +
                '<p class="hint">트레이딩은 별도 손익으로 기록합니다. ' +
                    "미래 수익은 배달 예상 시나리오에 넣지 않습니다.</p>" +
                '<form id="trading-form" class="stack">' +
                    '<label class="field"><span>적용 환율 · 1 USD당 원</span>' +
                        '<input name="rate" type="text" inputmode="decimal" ' +
                            `value="${e(suggestedRate)}" placeholder="직접 입력 또는 조회">` +
                    "</label>" +
                    '<div><button class="button secondary small" type="button" ' +
                        'data-action="fetch-rate">현재 환율 조회</button></div>' +
                    '<p class="hint">제안된 환율도 저장 전에 확인하세요. ' +
                        "현재 환율은 과거 거래일 환율이 아닙니다. 저장 후에는 자동 변경되지 않습니다.</p>" +
                    `<datalist id="symbols">${symbols.map(symbol =>
                        `<option value="${e(symbol)}"></option>`
                    ).join("")}</datalist>` +
                    '<div class="table-wrap"><table class="position-table">' +
                        "<thead><tr><th>종목</th><th>방향</th><th>랏수</th>" +
                            "<th>손익 USD</th><th>삭제</th></tr></thead>" +
                        '<tbody id="position-rows">' +
                            (record?.positions || []).map(tradingRow).join("") +
                        "</tbody>" +
                    "</table></div>" +
                    '<div class="actions">' +
                        '<button class="button secondary" type="button" ' +
                            'data-action="add-position">+ 포지션 추가</button>' +
                        '<button class="button secondary" type="button" ' +
                            'data-action="rename-symbol">저장된 종목 이름 변경</button>' +
                    "</div>" +
                    '<label class="field"><span>리베이트 · USD</span>' +
                        '<input name="rebate" type="text" inputmode="decimal" ' +
                            `value="${record ? (record.rebateCents / 100).toFixed(2) : ""}" ` +
                            'placeholder="미입력 시 0.00">' +
                    "</label>" +
                    '<label class="field"><span>메모 · 선택</span>' +
                        `<textarea name="note" maxlength="2000">${e(record?.note || "")}</textarea>` +
                    "</label>" +
                    '<div id="trading-preview"></div>' +
                    '<div class="actions">' +
                        '<button class="button" type="submit">트레이딩 저장</button>' +
                        (record
                            ? '<button class="button danger" type="button" ' +
                                'data-action="delete-trading">이 날짜 트레이딩 삭제</button>'
                            : "") +
                    "</div>" +
                "</form>" +
            "</section>" +
            '<details class="panel">' +
                "<summary>AI 거래 내역 가져오기</summary>" +
                '<p class="hint">외부 AI가 반환한 JSON을 검토한 뒤 입력표에 추가합니다. ' +
                    "앱이 AI를 직접 호출하지는 않습니다.</p>" +
                '<div class="actions">' +
                    '<button class="button secondary" data-action="copy-prompt">' +
                        "AI용 프롬프트 복사</button>" +
                "</div>" +
                '<label class="field"><span>AI 응답 JSON</span>' +
                    '<textarea id="trade-json" class="code-input"></textarea>' +
                "</label>" +
                '<div class="actions">' +
                    '<button class="button secondary" data-action="review-import">검토</button>' +
                    '<button class="button" data-action="apply-import" disabled>입력표에 추가</button>' +
                "</div>" +
                '<div id="import-status" class="import-status hint" role="status"></div>' +
                '<div id="import-preview" class="table-wrap" hidden></div>' +
            "</details>" +
            overview();

        updateTradingPreview();
    }

    function readPositions() {
        return Array.from(
            main.querySelectorAll("#position-rows tr")
        ).map((row, index) => {
            const field = name => row.querySelector(`[data-field="${name}"]`).value;

            return C.position({
                symbol: field("symbol"),
                side: field("side"),
                lots: field("lots"),
                pnlCents: C.cents(field("pnl")),
                ticket: row.dataset.ticket || null
            }, index + 1);
        });
    }

    function readTrading() {
        const form = document.getElementById("trading-form");

        return {
            rate: C.rate(form.elements.rate.value),
            rebateCents: C.cents(form.elements.rebate.value || "0", false),
            positions: readPositions(),
            note: form.elements.note.value.trim()
        };
    }

    function updateTradingPreview() {
        const element = document.getElementById("trading-preview");

        if (!element) {
            return;
        }

        try {
            const record = readTrading();
            const result = C.tradeDay(record);

            element.innerHTML =
                line("포지션 순손익", C.usd(result.pnlCents)) +
                line("원화 순손익", C.won(result.trading), result.trading < 0
                    ? "negative"
                    : "positive") +
                line("리베이트 원화", C.won(result.rebate)) +
                line("이 날짜 통합 반영액", C.won(result.total));
        } catch (error) {
            element.innerHTML = `<p class="hint">${e(error.message)}</p>`;
        }
    }

    function monthView() {
        const state = D.get();
        const total = C.totals(state, selectedMonth);
        const first = `${selectedMonth}-01`;
        const last = C.monthLast(first);
        const rows = [];

        const incomeCell = value =>
            value === null || value === undefined ? "—" : C.won(value);

        for (let date = first; date <= last; date = C.addDays(date, 1)) {
            const record = state.deliveries[date];
            const trading = state.trading[date];
            const trade = trading ? C.tradeDay(trading) : null;

            const hasDelivery = record && C.hasDelivery(record);
            const delivery = hasDelivery ? C.deliveryAmount(record) : null;
            const other = record?.other ?? null;

            const mode = !hasDelivery
                ? "—"
                : record.mode === "detail"
                    ? "상세"
                    : "합산";

            rows.push(
                "<tr>" +
                    `<td>${e(C.dateLabel(date))}</td>` +
                    `<td>${mode}</td>` +
                    `<td>${record?.mode === "detail" ? incomeCell(record.coupang) : "—"}</td>` +
                    `<td>${record?.mode === "detail" ? incomeCell(record.baemin) : "—"}</td>` +
                    `<td>${incomeCell(delivery)}</td>` +
                    `<td>${incomeCell(other)}</td>` +
                    `<td class="${trade?.total < 0 ? "negative" : ""}">` +
                        `${trade ? C.won(trade.total) : "—"}</td>` +
                    "<td>" +
                        '<button class="button secondary small" ' +
                            `data-open-date="${date}" data-kind="delivery">수입</button> ` +
                        '<button class="button secondary small" ' +
                            `data-open-date="${date}" data-kind="trading">거래</button>` +
                    "</td>" +
                "</tr>"
            );

            if (date === last) {
                break;
            }
        }

        main.innerHTML =
            '<section class="panel">' +
                "<h2>월별 기록</h2>" +
                '<label class="field"><span>조회 월</span>' +
                    `<input id="month-input" type="month" value="${selectedMonth}" ` +
                        `min="1900-01" max="${C.today().slice(0, 7)}">` +
                "</label>" +

                '<div class="grid" style="margin-top:16px">' +
                    metric("배달 수익", C.won(total.delivery), "main") +
                    metric("그 외 수입", C.won(total.other)) +
                    metric("트레이딩 순손익", C.won(total.trading)) +
                    metric("리베이트", C.won(total.rebate)) +
                    metric("통합 회복액", C.won(total.recovered), "main") +
                "</div>" +

                '<div class="table-wrap"><table>' +
                    "<thead><tr>" +
                        "<th>날짜</th><th>입력 방식</th>" +
                        "<th>쿠팡</th><th>배민</th>" +
                        "<th>배달 합계</th><th>그 외 수입</th>" +
                        "<th>거래+리베이트</th><th>열기</th>" +
                    "</tr></thead>" +
                    `<tbody>${rows.join("")}</tbody>` +
                "</table></div>" +

                '<p class="hint">합산 입력 기록은 쿠팡·배민으로 임의 분배하지 않습니다. ' +
                    "미래 날짜에는 실제 수입을 기록하지 않습니다.</p>" +
            "</section>" +
            overview();
    }

    function planForm() {
        const plan = D.get().settings.plan;
        const tomorrow = C.addDays(C.today(), 1);
        const start = C.effectiveStart(plan.start);

        return (
            '<section class="panel">' +
                "<h2>내 배달 목표</h2>" +
                '<form id="plan-form" class="stack">' +
                    moneyField(
                        "daily",
                        "하루 배달 목표 · 원",
                        plan.daily,
                        "40000"
                    ) +
                    '<div class="metric">' +
                        "<span>배달 일정</span>" +
                        "<strong>주 7일 · 매일</strong>" +
                    "</div>" +
                    '<label class="field"><span>계획 시작일</span>' +
                        `<input type="date" name="start" min="${tomorrow}" value="${start}">` +
                    "</label>" +
                    '<label class="field"><span>목표 완료일 · 역산용, 선택</span>' +
                        `<input type="date" name="deadline" min="${start}" ` +
                            `value="${e(plan.deadline || "")}">` +
                    "</label>" +
                    '<p class="hint">오늘까지 저장한 모든 수입·손익을 반영하고 ' +
                        "최소 내일부터 매일 배달한다고 계산합니다. " +
                        "미래의 그 외 수입과 트레이딩 수익은 예상에 넣지 않습니다.</p>" +
                    '<div class="actions"><button class="button" type="submit">' +
                        "목표 저장 · 시나리오 계산</button></div>" +
                "</form>" +
            "</section>"
        );
    }

    function scenarioCard(title, daily, remaining, plan, selected) {
        const start = C.effectiveStart(plan.start);
        const result = C.project(
            remaining,
            daily,
            start,
            C.ALL_DAYS
        );

        let body;

        if (result.workDays === 0) {
            body = "<p>이미 회복 목표에 도달했습니다.</p>";
        } else if (result.workDays === null) {
            body = "<p>하루 수입이 0원이어서 예상 기간을 계산할 수 없습니다.</p>";
        } else {
            body =
                `<p>필요한 배달 <b>${C.integer(result.workDays)}일</b></p>` +
                `<p>예상 완료 <b>${result.finish
                    ? e(C.dateLabel(result.finish))
                    : "날짜 표시 범위 초과"}</b></p>` +
                (result.finish
                    ? `<p>시작일부터 달력 기준 ${C.integer(result.calendarDays)}일</p>`
                    : "");
        }

        return (
            `<article class="scenario-card${selected ? " selected" : ""}">` +
                `<h3>${e(title)}</h3>` +
                `<strong>${C.won(daily)} / 하루</strong>` +
                "<p>주 7일 배달 기준</p>" +
                body +
                (daily > 0
                    ? '<button class="button secondary small" ' +
                        `data-select-plan="${daily}">이 금액을 목표로 선택</button>`
                    : '<p class="hint">양수 수입이 쌓이면 목표로 선택할 수 있습니다.</p>') +
            "</article>"
        );
    }

    function scenarios() {
        const state = D.get();
        const loss = state.settings.lossWon;

        if (loss === null) {
            return "";
        }

        const total = C.totals(state);
        const remaining = Math.max(0, loss - total.recovered);
        const plan = state.settings.plan;
        const actual = C.deliveryAverage(state.deliveries);

        const options = [
            ["보수적으로 · 하루 3만 원", 30000],
            ["평소 수준 · 하루 3만 5천 원", 35000],
            ["하루 4만 원", 40000],
            ["높은 수입 참고 · 하루 6만 원", 60000],
            ["직접 설정한 목표", plan.daily]
        ];

        if (actual.days > 0) {
            options.push([
                `실제 배달 기록일 평균 · ${actual.days}일`,
                actual.average
            ]);
        }

        let reverse = "";

        if (plan.deadline) {
            const result = C.reverse(
                remaining,
                C.effectiveStart(plan.start),
                plan.deadline,
                C.ALL_DAYS
            );

            reverse =
                '<section class="panel">' +
                    "<h2>목표 완료일에서 역산</h2>" +
                    line("목표 완료일", C.dateLabel(plan.deadline)) +
                    line("배달 가능한 날 · 주 7일", `${C.integer(result.availableDays)}일`) +
                    (result.requiredDaily === null
                        ? '<p class="notice">현재 계획 시작일 이후에 완료일을 지정하세요.</p>'
                        : line("필요한 하루 배달 수익", C.won(result.requiredDaily)) +
                            (result.requiredDaily > 60000
                                ? '<p class="notice">필요한 하루 수익이 6만 원을 넘습니다. ' +
                                    "목표 완료일을 늦추는 계획도 비교해 보세요.</p>"
                                : result.requiredDaily > 40000
                                    ? '<p class="notice">평소 예상한 하루 3만~4만 원보다 높은 목표입니다.</p>'
                                    : "") +
                            (result.requiredDaily > 0
                                ? '<div class="actions"><button class="button secondary" ' +
                                    `data-select-plan="${result.requiredDaily}">` +
                                    "역산 금액을 내 목표로 선택</button></div>"
                                : '<p class="hint">이미 회복 목표에 도달했습니다.</p>')) +
                "</section>";
        }

        return (
            '<section class="panel">' +
                "<h2>배달 수입별 예상 시나리오</h2>" +
                line("현재 남은 손실", C.won(remaining)) +
                line("계산 시작일", C.dateLabel(C.effectiveStart(plan.start))) +
                line("배달 일정", "주 7일 · 매일") +
                '<div class="scenario-cards">' +
                    options.map(([title, daily]) =>
                        scenarioCard(
                            title,
                            daily,
                            remaining,
                            plan,
                            daily === plan.daily
                        )
                    ).join("") +
                "</div>" +
                '<p class="hint">예상치는 수익을 보장하지 않습니다. ' +
                    "매일 같은 배달 수입이 발생한다고 가정합니다. " +
                    "그 외 수입과 트레이딩은 이미 저장한 실적만 남은 손실에 반영하고 " +
                    "미래 예상 수익은 넣지 않습니다. " +
                    "실제 평균에는 배달 0원 기록을 포함하며 " +
                    "배달 미입력일과 그 외 수입만 있는 날은 제외합니다.</p>" +
            "</section>" +
            reverse
        );
    }

    function planView() {
        main.innerHTML = overview() + planForm() + scenarios();
    }

    function settingsView() {
        const state = D.get();
        const github = D.githubConfig();

        main.innerHTML =
            '<section class="panel">' +
                "<h2>프로젝트 설정</h2>" +
                '<form id="settings-form" class="stack">' +
                    moneyField(
                        "loss",
                        "시작 손실금액 · 원",
                        state.settings.lossWon,
                        "새 출발 기준 손실을 입력하세요"
                    ) +
                    '<p class="hint">현재 남은 손실이 아니라 프로젝트의 시작 손실입니다. ' +
                        "기록이 쌓인 뒤 이 금액을 바꾸면 남은 손실도 바뀝니다.</p>" +
                    '<div class="actions"><button class="button" type="submit">설정 저장</button></div>' +
                "</form>" +
            "</section>" +
            '<section class="panel">' +
                "<h2>JSON 백업과 복원</h2>" +
                '<p class="hint">복원은 현재 기록 전체를 교체합니다. ' +
                    "기존 MinusWrite 데이터는 가져오지 않습니다.</p>" +
                '<div class="actions"><button class="button secondary" ' +
                    'data-action="export">JSON 백업 다운로드</button></div>' +
                '<label class="field" style="margin-top:16px"><span>백업 파일 복원</span>' +
                    '<input id="backup-file" type="file" accept=".json,application/json">' +
                "</label>" +
            "</section>" +
            '<details class="panel">' +
                "<summary>GitHub 자동 동기화 설정</summary>" +
                '<p class="hint">수입·트레이딩·설정·목표를 저장하면 GitHub에도 자동 반영합니다. ' +
                    "실패한 변경분은 이 기기에 남겨 다음에 다시 시도합니다. " +
                    "원격 파일은 data/recovery-log.json입니다.</p>" +
                '<form id="github-form" class="stack">' +
                    '<label class="field"><span>소유자</span>' +
                        `<input name="owner" value="${e(github.owner)}" autocomplete="off"></label>` +
                    '<label class="field"><span>저장소</span>' +
                        `<input name="repo" value="${e(github.repo)}" autocomplete="off"></label>` +
                    '<label class="field"><span>브랜치</span>' +
                        `<input name="branch" value="${e(github.branch)}" autocomplete="off"></label>` +
                    '<label class="field"><span>토큰 · 이 브라우저에 저장</span>' +
                        '<input name="token" type="password" autocomplete="off" ' +
                            `value="${e(D.getToken())}"></label>` +
                    '<p class="hint">해당 저장소의 Contents 읽기·쓰기 권한이 필요합니다. ' +
                        "토큰은 이 브라우저에 보관하며 앱을 다시 열어도 사용합니다. " +
                        "JSON 백업이나 GitHub 기록 파일에는 포함되지 않습니다. " +
                        "개인 기기에서만 사용하세요. " +
                        "토큰을 삭제하려면 입력칸을 비우고 연결 정보를 저장하세요.</p>" +
                    '<div class="actions"><button class="button secondary" type="submit">' +
                        "연결 정보 저장 · 동기화</button></div>" +
                "</form>" +
                '<div class="actions">' +
                    '<button class="button" data-action="github-push">동기화 재시도</button>' +
                    '<button class="button secondary" data-action="github-pull">최신 기록 확인</button>' +
                "</div>" +
                '<p class="hint">공개 저장소의 기록은 공개될 수 있습니다. ' +
                    "동일 날짜를 여러 기기에서 수정하면 나중에 동기화한 변경이 적용됩니다. " +
                    "저장소를 바꾸기 전에는 JSON 백업을 보관하세요.</p>" +
            "</details>" +
            '<section class="panel">' +
                "<h2>기록 기준</h2>" +
                '<p class="hint">배달과 그 외 수입은 비용 차감 없이 전액 반영합니다. ' +
                    "배달은 상세 입력과 합산 입력 중 선택한 방식만 계산합니다. " +
                    "그 외 수입은 배달 평균에서 제외합니다. " +
                    "트레이딩은 날짜별 저장 환율을 사용합니다. " +
                    "실제 상환액이나 은행 잔액을 관리하는 앱은 아닙니다.</p>" +
                '<p class="hint">브라우저 데이터를 삭제하면 로컬 기록이 사라질 수 있습니다. ' +
                    "백업을 주기적으로 보관하세요.</p>" +
            "</section>";
    }

    function render() {
        if (!ready) {
            return;
        }

        const renderers = {
            delivery: deliveryView,
            month: monthView,
            plan: planView,
            trading: tradingView,
            settings: settingsView
        };

        renderers[view]();
        markSaved();

        document.querySelectorAll(".bottom-nav [data-view]").forEach(button => {
            const active = button.dataset.view === view;

            button.classList.toggle("active", active);

            if (active) {
                button.setAttribute("aria-current", "page");
            } else {
                button.removeAttribute("aria-current");
            }
        });
    }

    function navigate(nextView) {
        if (!ready || !canLeave()) {
            return;
        }

        view = nextView;
        render();
        window.scrollTo(0, 0);
    }

    function changeDate(nextDate) {
        C.recordDate(nextDate);

        if (!canLeave()) {
            return false;
        }

        selectedDate = nextDate;
        render();

        return true;
    }

    function readPlan(form) {
        return C.plan({
            daily: C.requiredWon(form.elements.daily.value),
            start: form.elements.start.value,
            deadline: form.elements.deadline.value || null
        });
    }

    function download(text, filename, type = "application/json;charset=utf-8") {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download = filename;

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function submitForm(form) {
        if (form.id === "delivery-form") {
            const record = readDelivery();

            if (!C.hasDelivery(record) && record.other === null) {
                throw new Error(
                    "배달 또는 그 외 수입을 입력하세요. 수입이 없으면 0으로 기록할 수 있습니다."
                );
            }

            D.saveDelivery(selectedDate, record);
            await saveAndSync("수입을 이 기기에 저장했습니다.");
        } else if (form.id === "trading-form") {
            const record = readTrading();

            if (!record.positions.length && record.rebateCents === 0) {
                throw new Error("포지션 또는 리베이트를 입력하세요. 전체 삭제는 삭제 버튼을 사용하세요.");
            }

            D.saveTrading(selectedDate, record);
            await saveAndSync("트레이딩과 적용 환율을 이 기기에 저장했습니다.");
        } else if (form.id === "plan-form") {
            const plan = readPlan(form);

            D.update(state => {
                state.settings.plan = plan;
            });

            await saveAndSync("하루 배달 목표를 이 기기에 저장했습니다.");
        } else if (form.id === "settings-form") {
            const loss = C.requiredWon(form.elements.loss.value);
            const current = D.get().settings.lossWon;

            if (current !== null && current !== loss && !window.confirm(
                "시작 손실을 바꾸면 남은 손실과 예상 완료일도 바뀝니다. 변경할까요?"
            )) {
                return;
            }

            D.update(state => {
                state.settings.lossWon = loss;
            });

            await saveAndSync("시작 손실을 이 기기에 저장했습니다.");
        } else if (form.id === "github-form") {
            const nextConfig = {
                owner: form.elements.owner.value.trim(),
                repo: form.elements.repo.value.trim(),
                branch: form.elements.branch.value.trim()
            };

            const previous = D.githubConfig();

            const changed =
                previous.owner !== nextConfig.owner ||
                previous.repo !== nextConfig.repo ||
                previous.branch !== nextConfig.branch;

            if (changed && previous.owner && previous.repo &&
                !window.confirm(
                    "GitHub 연결 대상을 변경합니다.\n" +
                    "새 대상의 기록과 이 기기의 미동기 변경분을 합칩니다.\n" +
                    "현재 기록을 JSON으로 백업한 뒤 변경하는 것을 권장합니다. 계속할까요?"
                )) {
                return;
            }

            D.configureGithub(
                nextConfig,
                form.elements.token.value.trim()
            );

            dirty = false;
            render();

            const request = D.load();

            renderSyncBadge();

            const result = await request;

            render();
            notifySync(result, "연결 정보를 저장했습니다.");
        }
    }

    async function action(name, button) {
        if (name === "today") {
            changeDate(C.today());
        } else if (name === "previous-date") {
            changeDate(C.addDays(selectedDate, -1));
        } else if (name === "next-date") {
            changeDate(C.addDays(selectedDate, 1));
        } else if (name === "delete-delivery") {
            if (window.confirm(
                "이 날짜의 배달과 그 외 수입을 삭제할까요? 트레이딩은 유지됩니다."
            )) {
                D.saveDelivery(selectedDate, null);
                await saveAndSync("이 날짜의 수입 기록을 이 기기에서 삭제했습니다.");
            }
        } else if (name === "delete-trading") {
            if (window.confirm("이 날짜의 트레이딩 기록만 삭제할까요? 배달은 유지됩니다.")) {
                D.saveTrading(selectedDate, null);
                await saveAndSync("이 날짜의 트레이딩을 이 기기에서 삭제했습니다.");
            }
        } else if (name === "add-position") {
            const rows = document.getElementById("position-rows");

            if (rows.children.length >= 2000) {
                throw new Error("하루 포지션은 최대 2,000건입니다.");
            }

            rows.insertAdjacentHTML("beforeend", tradingRow());
            markDirty();
            updateTradingPreview();

            rows.lastElementChild.querySelector("input").focus();
        } else if (name === "remove-position") {
            if (window.confirm("이 포지션을 입력표에서 제거할까요? 저장하면 반영됩니다.")) {
                button.closest("tr").remove();
                markDirty();
                updateTradingPreview();
            }
        } else if (name === "fetch-rate") {
            const rate = await D.fetchRate();

            document.getElementById("trading-form").elements.rate.value = rate;
            markDirty();
            updateTradingPreview();
            toast("현재 조회 환율입니다. 거래일에 적용할 값인지 확인한 뒤 저장하세요.");
        } else if (name === "rename-symbol") {
            if (dirty) {
                throw new Error("현재 트레이딩 입력을 먼저 저장한 뒤 종목 이름을 변경하세요.");
            }

            const from = window.prompt("변경할 기존 종목명");

            if (from === null) {
                return;
            }

            const to = window.prompt("새 종목명", from.toUpperCase());

            if (to === null) {
                return;
            }

            if (window.confirm("저장된 모든 날짜의 해당 종목명을 변경할까요?")) {
                D.renameSymbol(from, to);
                await saveAndSync("저장된 종목명을 이 기기에서 변경했습니다.");
            }
        } else if (name === "copy-prompt") {
            const prompt = T.makePrompt(selectedDate);

            try {
                await navigator.clipboard.writeText(prompt);
                toast("프롬프트를 복사했습니다.");
            } catch (error) {
                window.prompt("아래 내용을 복사하세요.", prompt);
            }
        } else if (name === "review-import") {
            importedTrades = null;
            main.querySelector('[data-action="apply-import"]').disabled = true;

            const raw = document.getElementById("trade-json").value;
            const parsed = T.parse(raw, selectedDate);
            const existing = readPositions();

            const duplicates = parsed.trades.filter(trade =>
                existing.some(position =>
                    position.ticket && position.ticket === trade.ticket ||
                    T.signature(position) === T.signature(trade)
                )
            ).length;

            importedTrades = { raw, parsed, duplicates };

            document.getElementById("import-status").textContent =
                `${parsed.trades.length}건 · 합계 ${C.usd(parsed.totalCents)}\n` +
                `기존 입력과 겹칠 가능성: ${duplicates}건\n` +
                (parsed.warnings.length
                    ? parsed.warnings.map(warning => `주의: ${warning}`).join("\n")
                    : "원본 거래 화면과 직접 대조한 뒤 추가하세요.");

            const preview = document.getElementById("import-preview");

            preview.hidden = false;
            preview.innerHTML =
                "<table><thead><tr><th>종목</th><th>방향</th><th>랏수</th>" +
                    "<th>손익 USD</th></tr></thead><tbody>" +
                parsed.trades.map(trade =>
                    `<tr><td>${e(trade.symbol)}</td><td>${e(trade.side)}</td>` +
                        `<td>${e(trade.lots)}</td><td>${C.usd(trade.pnlCents)}</td></tr>`
                ).join("") +
                "</tbody></table>";

            main.querySelector('[data-action="apply-import"]').disabled = false;
        } else if (name === "apply-import") {
            if (!importedTrades ||
                importedTrades.raw !== document.getElementById("trade-json").value) {
                throw new Error("JSON이 변경되었습니다. 다시 검토하세요.");
            }

            const existing = readPositions();
            const additions = importedTrades.parsed.trades;

            if (existing.length + additions.length > 2000) {
                throw new Error("추가 후 포지션이 2,000건을 넘습니다.");
            }

            const existingTickets = new Set(
                existing.map(position => position.ticket).filter(Boolean)
            );

            if (additions.some(position =>
                position.ticket && existingTickets.has(position.ticket)
            )) {
                throw new Error("같은 거래번호가 이미 입력표에 있습니다. 중복 거래를 제거하세요.");
            }

            if (!window.confirm(
                `${additions.length}건을 입력표에 추가할까요?\n` +
                "경고 및 값이 같은 거래가 있다면 원본에서 중복 여부를 확인하세요.\n" +
                "추가 후 별도로 트레이딩 저장을 눌러야 합니다."
            )) {
                return;
            }

            document.getElementById("position-rows").insertAdjacentHTML(
                "beforeend",
                additions.map(tradingRow).join("")
            );

            importedTrades = null;
            button.disabled = true;
            document.getElementById("import-status").textContent =
                "입력표에 추가했습니다. 아직 저장되지 않았습니다.";

            markDirty();
            updateTradingPreview();
        } else if (name === "export") {
            download(
                JSON.stringify(D.get(), null, 2),
                `recovery-log-${C.today()}.json`
            );

            toast("백업 파일을 다운로드했습니다.");
        } else if (name === "github-pull" || name === "github-push") {
            const request = D.sync();

            renderSyncBadge();

            const result = await request;

            render();
            notifySync(result);
        } else if (name === "export-raw") {
            download(D.raw(), `recovery-log-original-${Date.now()}.txt`, "text/plain");
        }
    }

    document.addEventListener("click", event => {
        const button = event.target.closest("button");

        if (!button || busy) {
            return;
        }

        if (button.dataset.view) {
            navigate(button.dataset.view);
            return;
        }

        if (button.dataset.openDate) {
            try {
                if (C.recordDate(button.dataset.openDate) && canLeave()) {
                    selectedDate = button.dataset.openDate;
                    view = button.dataset.kind;
                    render();
                }
            } catch (error) {
                report(error);
            }

            return;
        }

        if (button.dataset.selectPlan) {
            if (!canLeave()) {
                return;
            }

            run(async () => {
                const daily = C.requiredWon(button.dataset.selectPlan);

                if (daily <= 0) {
                    throw new Error("하루 배달 목표는 0원보다 커야 합니다.");
                }

                D.update(state => {
                    state.settings.plan.daily = daily;
                });

                await saveAndSync("하루 배달 목표로 선택해 이 기기에 저장했습니다.");
            });

            return;
        }

        if (button.dataset.action) {
            const name = button.dataset.action;

            if (name === "review-import" || name === "apply-import") {
                try {
                    Promise.resolve(action(name, button)).catch(report);
                } catch (error) {
                    report(error);
                }

                return;
            }

            run(() => action(name, button));
        }
    });

    main.addEventListener("submit", event => {
        event.preventDefault();
        run(() => submitForm(event.target));
    });

    main.addEventListener("input", event => {
        if (event.target.closest("form")) {
            markDirty();
        }

        if (event.target.closest("#delivery-form")) {
            updateDeliveryPreview();
        }

        if (event.target.closest("#trading-form")) {
            updateTradingPreview();
        }

        if (event.target.id === "trade-json") {
            importedTrades = null;

            const button = main.querySelector('[data-action="apply-import"]');

            if (button) {
                button.disabled = true;
            }
        }
    });

    main.addEventListener("change", event => {
        const target = event.target;

        if (target.closest("form")) {
            markDirty();
        }

        if (target.id === "record-date") {
            try {
                if (!changeDate(target.value)) {
                    target.value = selectedDate;
                }
            } catch (error) {
                target.value = selectedDate;
                report(error);
            }
        } else if (target.id === "month-input") {
            try {
                C.validDate(`${target.value}-01`);

                if (target.value > C.today().slice(0, 7)) {
                    throw new Error("미래 월은 조회할 수 없습니다.");
                }

                selectedMonth = target.value;
                render();
            } catch (error) {
                target.value = selectedMonth;
                report(error);
            }
        } else if (target.id === "backup-file") {
            const file = target.files[0];

            if (!file) {
                return;
            }

            run(async () => {
                if (file.size > 10 * 1024 * 1024) {
                    throw new Error("백업 파일은 10MB 이하만 허용합니다.");
                }

                const restored = D.validate(JSON.parse(await file.text()));
                const count = Object.keys(restored.deliveries).length;
                const trades = Object.keys(restored.trading).length;

                if (!window.confirm(
                    `수입 ${count}일, 트레이딩 ${trades}일의 백업으로 교체할까요?\n` +
                    "현재 로컬 기록은 교체됩니다."
                )) {
                    target.value = "";
                    return;
                }

                D.replace(restored);
                ready = true;
                view = "settings";
                await saveAndSync("백업을 이 기기에 복원했습니다.");
            });
        }
    });

    window.addEventListener("beforeunload", event => {
        if (dirty || busy) {
            event.preventDefault();
            event.returnValue = "";
        }
    });

    window.addEventListener("storage", event => {
        if (event.key === D.KEY || event.key === null) {
            document.getElementById("save-status").textContent = "다른 탭 변경 · 새로고침 필요";
            toast("다른 탭에서 기록이 바뀌었습니다. 현재 입력을 보관한 뒤 새로고침하세요.");
        }
    });

    async function initialize() {
        await run(async () => {
            try {
                D.init();
                ready = true;
                render();

                const request = D.load();

                renderSyncBadge();

                const result = await request;

                render();

                if (!result.ok) {
                    toast(result.reason);
                }
            } catch (error) {
                console.error(error);
                ready = false;

                main.innerHTML =
                    '<section class="panel">' +
                        "<h2>저장 데이터를 확인해야 합니다</h2>" +
                        `<p class="negative">${e(error.message)}</p>` +
                        '<p class="hint">기존 저장값을 자동으로 지우지 않았습니다. ' +
                            "원본을 내려받거나 정상 백업을 복원하세요. " +
                            "브라우저 저장이 차단되어 있다면 먼저 허용해야 합니다.</p>" +
                        '<div class="actions"><button class="button secondary" ' +
                            'data-action="export-raw">기존 저장 원본 다운로드</button></div>' +
                        '<label class="field" style="margin-top:16px"><span>정상 백업 복원</span>' +
                            '<input id="backup-file" type="file" accept=".json,application/json">' +
                        "</label>" +
                    "</section>";
            }
        });
    }

    initialize();

    return Object.freeze({ toast });
})();