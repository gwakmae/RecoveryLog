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
        document.getElementById("save-status").textContent = "브라우저 저장";
    }

    async function run(task) {
        if (busy) {
            return;
        }

        busy = true;

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

            busy = false;
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
                line("트레이딩 순손익", C.won(total.trading), total.trading < 0
                    ? "negative"
                    : "positive") +
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
        const plan = state.settings.plan;
        const month = C.totals(state, selectedDate.slice(0, 7));
        const total = C.totals(state);

        main.innerHTML =
            '<section class="panel">' +
                "<h2>오늘 배달</h2>" +
                dateBar() +
                '<form id="delivery-form" class="stack">' +
                    '<div class="grid">' +
                        moneyField("morning", "배달－오전 · 원", record?.morning) +
                        moneyField("afternoon", "배달－오후 · 원", record?.afternoon) +
                    "</div>" +
                    '<div class="metric main">' +
                        "<span>이 날짜 배달 합계</span>" +
                        '<strong id="delivery-preview">0원</strong>' +
                    "</div>" +
                    '<div id="daily-target"></div>' +
                    '<label class="field"><span>메모 · 선택</span>' +
                        `<textarea name="note" maxlength="2000">${e(record?.note || "")}</textarea>` +
                    "</label>" +
                    '<p class="hint">빈칸은 미입력, 0은 수입 없음입니다. ' +
                        "오전·오후 중 하나만 입력해도 저장할 수 있습니다.</p>" +
                    '<div class="actions">' +
                        '<button class="button" type="submit">배달 저장</button>' +
                        (record
                            ? '<button class="button danger" type="button" ' +
                                'data-action="delete-delivery">이 날짜 배달 삭제</button>'
                            : "") +
                    "</div>" +
                "</form>" +
            "</section>" +
            '<section class="panel">' +
                `<h2>${e(selectedDate.slice(0, 7))} 배달</h2>` +
                '<div class="grid">' +
                    metric("이번 달 배달 수익", C.won(month.delivery)) +
                    metric("전체 배달 수익", C.won(total.delivery)) +
                "</div>" +
                `<p class="hint">선택한 목표: 오전 ${C.won(plan.morning)} + ` +
                    `오후 ${C.won(plan.afternoon)}</p>` +
                '<div class="actions"><button class="button secondary" ' +
                    'data-view="plan">예상 완료일과 목표 보기</button></div>' +
            "</section>" +
            overview();

        updateDeliveryPreview();
    }

    function readDelivery() {
        const form = document.getElementById("delivery-form");

        return {
            morning: C.optionalWon(form.elements.morning.value),
            afternoon: C.optionalWon(form.elements.afternoon.value),
            note: form.elements.note.value.trim()
        };
    }

    function updateDeliveryPreview() {
        const amount = document.getElementById("delivery-preview");
        const target = document.getElementById("daily-target");

        if (!amount || !target) {
            return;
        }

        try {
            const record = readDelivery();
            const sum = (record.morning ?? 0) + (record.afternoon ?? 0);
            const plan = D.get().settings.plan;
            const goal = plan.morning + plan.afternoon;
            const workingDay = plan.weekdays.includes(C.weekday(selectedDate));

            amount.textContent = C.won(sum);
            target.innerHTML =
                line("선택한 하루 목표", C.won(goal)) +
                line(
                    sum >= goal ? "목표 초과" : "목표까지",
                    C.won(Math.abs(goal - sum)),
                    sum >= goal ? "positive" : ""
                ) +
                '<p class="hint">' +
                    (workingDay
                        ? "선택한 배달 요일입니다."
                        : "계획상 쉬는 요일입니다. 실제 수입은 그대로 기록할 수 있습니다.") +
                "</p>";
        } catch (error) {
            amount.textContent = "금액 확인";
            target.innerHTML = `<p class="negative">${e(error.message)}</p>`;
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

        for (let date = first; date <= last; date = C.addDays(date, 1)) {
            const delivery = state.deliveries[date];
            const trading = state.trading[date];
            const day = trading ? C.tradeDay(trading) : null;
            const deliveryTotal = delivery
                ? (delivery.morning ?? 0) + (delivery.afternoon ?? 0)
                : null;

            rows.push(
                "<tr>" +
                    `<td>${e(C.dateLabel(date))}</td>` +
                    `<td>${delivery ? C.won(delivery.morning ?? 0) : "—"}` +
                        (delivery && delivery.morning === null ? " · 미입력" : "") +
                    "</td>" +
                    `<td>${delivery ? C.won(delivery.afternoon ?? 0) : "—"}` +
                        (delivery && delivery.afternoon === null ? " · 미입력" : "") +
                    "</td>" +
                    `<td>${deliveryTotal === null ? "—" : C.won(deliveryTotal)}</td>` +
                    `<td class="${day?.total < 0 ? "negative" : ""}">` +
                        `${day ? C.won(day.total) : "—"}</td>` +
                    '<td><button class="button secondary small" ' +
                        `data-open-date="${date}" data-kind="delivery">배달</button> ` +
                        '<button class="button secondary small" ' +
                        `data-open-date="${date}" data-kind="trading">거래</button></td>` +
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
                    metric("통합 회복액", C.won(total.recovered)) +
                    metric("트레이딩 순손익", C.won(total.trading)) +
                    metric("리베이트", C.won(total.rebate)) +
                "</div>" +
                '<div class="table-wrap"><table>' +
                    "<thead><tr><th>날짜</th><th>오전</th><th>오후</th>" +
                        "<th>배달 합계</th><th>거래+리베이트</th><th>열기</th></tr></thead>" +
                    `<tbody>${rows.join("")}</tbody>` +
                "</table></div>" +
                '<p class="hint">미래 날짜에는 실제 수입을 기록하지 않습니다.</p>' +
            "</section>" +
            overview();
    }

    function planForm() {
        const plan = D.get().settings.plan;
        const labels = ["일", "월", "화", "수", "목", "금", "토"];
        const tomorrow = C.addDays(C.today(), 1);
        const start = C.effectiveStart(plan.start);

        return (
            '<section class="panel">' +
                "<h2>내 배달 목표</h2>" +
                '<form id="plan-form" class="stack">' +
                    '<div class="grid">' +
                        moneyField("morning", "오전 목표 · 원", plan.morning, "20000") +
                        moneyField("afternoon", "오후 목표 · 원", plan.afternoon, "20000") +
                    "</div>" +
                    "<div><h3>배달하는 요일</h3>" +
                        '<div class="weekdays">' +
                            labels.map((label, day) =>
                                "<label>" +
                                    `<input type="checkbox" name="weekday" value="${day}"` +
                                        (plan.weekdays.includes(day) ? " checked" : "") +
                                    `>${label}</label>`
                            ).join("") +
                        "</div>" +
                    "</div>" +
                    '<label class="field"><span>계획 시작일</span>' +
                        `<input type="date" name="start" min="${tomorrow}" value="${start}">` +
                    "</label>" +
                    '<label class="field"><span>목표 완료일 · 역산용, 선택</span>' +
                        `<input type="date" name="deadline" min="${start}" ` +
                            `value="${e(plan.deadline || "")}">` +
                    "</label>" +
                    '<p class="hint">오늘까지 저장한 실적을 반영하고, 최소 내일부터 계산합니다. ' +
                        "선택한 요일에만 수입이 발생한다고 가정합니다.</p>" +
                    '<div class="actions"><button class="button" type="submit">' +
                        "목표 저장 · 시나리오 계산</button></div>" +
                "</form>" +
            "</section>"
        );
    }

    function scenarioCard(title, daily, morning, afternoon, remaining, plan, selected) {
        const start = C.effectiveStart(plan.start);
        const result = C.project(remaining, daily, start, plan.weekdays);

        let body;

        if (result.workDays === 0) {
            body = "<p>이미 회복 목표에 도달했습니다.</p>";
        } else if (result.workDays === null) {
            body = "<p>하루 목표가 0원이어서 예상 기간을 계산할 수 없습니다.</p>";
        } else {
            body =
                `<p>필요한 배달 <b>${C.integer(result.workDays)}일</b></p>` +
                `<p>예상 완료 <b>${result.finish ? e(C.dateLabel(result.finish)) : "날짜 표시 범위 초과"}</b></p>` +
                (result.finish
                    ? `<p>시작일부터 달력 기준 ${C.integer(result.calendarDays)}일</p>`
                    : "");
        }

        return (
            `<article class="scenario-card${selected ? " selected" : ""}">` +
                `<h3>${e(title)}</h3>` +
                `<strong>${C.won(daily)} / 배달일</strong>` +
                `<p>오전 ${C.won(morning)} · 오후 ${C.won(afternoon)}</p>` +
                body +
                '<button class="button secondary small" ' +
                    `data-select-plan="${morning},${afternoon}">이 금액을 목표로 선택</button>` +
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
        const custom = plan.morning + plan.afternoon;
        const actual = C.deliveryAverage(state.deliveries);

        const options = [
            ["보수적으로 · 하루 3만 원", 30000, 15000, 15000],
            ["평소 수준 · 하루 3만 5천 원", 35000, 15000, 20000],
            ["오전·오후 각 2만 원", 40000, 20000, 20000],
            ["높은 수입 참고 · 하루 6만 원", 60000, 30000, 30000],
            ["직접 설정한 목표", custom, plan.morning, plan.afternoon]
        ];

        if (actual.days > 0) {
            const morning = Math.floor(actual.average / 2);

            options.push([
                `실제 기록일 평균 · ${actual.days}일`,
                actual.average,
                morning,
                actual.average - morning
            ]);
        }

        let reverse = "";

        if (plan.deadline) {
            const result = C.reverse(
                remaining,
                C.effectiveStart(plan.start),
                plan.deadline,
                plan.weekdays
            );

            reverse =
                '<section class="panel">' +
                    "<h2>목표 완료일에서 역산</h2>" +
                    line("목표 완료일", C.dateLabel(plan.deadline)) +
                    line("배달 가능한 날", `${C.integer(result.availableDays)}일`) +
                    (result.requiredDaily === null
                        ? '<p class="notice">현재 시작일과 요일 조건으로는 완료일까지 배달 가능한 날이 없습니다.</p>'
                        : line("필요한 하루 수익", C.won(result.requiredDaily)) +
                            line("오전 목표 예시", C.won(result.morning)) +
                            line("오후 목표 예시", C.won(result.afternoon)) +
                            (result.requiredDaily > 60000
                                ? '<p class="notice">필요한 하루 수익이 6만 원을 넘습니다. ' +
                                    "기한을 늘리거나 배달 요일을 조정해 보세요.</p>"
                                : result.requiredDaily > 40000
                                    ? '<p class="notice">평소 예상한 하루 3만~4만 원보다 높은 목표입니다.</p>'
                                    : "") +
                            '<div class="actions"><button class="button secondary" ' +
                                `data-select-plan="${result.morning},${result.afternoon}">` +
                                "역산 금액을 내 목표로 선택</button></div>") +
                "</section>";
        }

        return (
            '<section class="panel">' +
                "<h2>배달 수입별 예상 시나리오</h2>" +
                line("현재 남은 손실", C.won(remaining)) +
                line("계산 시작일", C.dateLabel(C.effectiveStart(plan.start))) +
                line("주당 배달 일수", `${plan.weekdays.length}일`) +
                '<div class="scenario-cards">' +
                    options.map(([title, daily, morning, afternoon]) =>
                        scenarioCard(
                            title,
                            daily,
                            morning,
                            afternoon,
                            remaining,
                            plan,
                            morning === plan.morning && afternoon === plan.afternoon
                        )
                    ).join("") +
                "</div>" +
                '<p class="hint">예상치는 수익을 보장하지 않습니다. 공휴일·날씨·수입 변동은 ' +
                    "자동 반영하지 않으며 미래 트레이딩 수익도 포함하지 않습니다. " +
                    "실제 평균은 0원 기록을 포함하고 미입력일은 제외하며 원 미만은 버립니다.</p>" +
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
                "<summary>GitHub 수동 동기화 · 선택</summary>" +
                '<p class="hint">새 파일 data/recovery-log.json을 사용합니다. ' +
                    "자동 병합하지 않으며 원격 버전이 달라지면 업로드를 중단합니다. " +
                    "공개 저장소에 올린 기록은 공개될 수 있습니다.</p>" +
                '<form id="github-form" class="stack">' +
                    '<label class="field"><span>소유자</span>' +
                        `<input name="owner" value="${e(github.owner)}" autocomplete="off"></label>` +
                    '<label class="field"><span>저장소</span>' +
                        `<input name="repo" value="${e(github.repo)}" autocomplete="off"></label>` +
                    '<label class="field"><span>브랜치</span>' +
                        `<input name="branch" value="${e(github.branch)}" autocomplete="off"></label>` +
                    '<label class="field"><span>토큰 · 현재 탭의 세션에만 저장</span>' +
                        '<input name="token" type="password" autocomplete="off" ' +
                            `value="${e(D.getToken())}"></label>` +
                    '<p class="hint">쓰기는 해당 저장소의 Contents 읽기·쓰기 권한이 필요합니다. ' +
                        "토큰은 JSON 백업에 포함되지 않습니다.</p>" +
                    '<div class="actions"><button class="button secondary" type="submit">' +
                        "연결 정보 저장</button></div>" +
                "</form>" +
                '<div class="actions">' +
                    '<button class="button secondary" data-action="github-pull">원격 불러오기</button>' +
                    '<button class="button" data-action="github-push">원격 업로드</button>' +
                "</div>" +
            "</details>" +
            '<section class="panel">' +
                "<h2>기록 기준</h2>" +
                '<p class="hint">배달 수입은 비용 차감 없이 전액 반영합니다. ' +
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
        const start = form.elements.start.value;
        const deadline = form.elements.deadline.value || null;
        const weekdays = Array.from(
            form.querySelectorAll('[name="weekday"]:checked')
        ).map(input => Number(input.value));

        return C.plan({
            morning: C.requiredWon(form.elements.morning.value),
            afternoon: C.requiredWon(form.elements.afternoon.value),
            weekdays,
            start,
            deadline
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

            if (record.morning === null && record.afternoon === null) {
                throw new Error("오전·오후 중 하나에 수익을 입력하세요. 수입이 없으면 0입니다.");
            }

            D.saveDelivery(selectedDate, record);
            render();
            toast("배달 수익을 저장했습니다.");
        } else if (form.id === "trading-form") {
            const record = readTrading();

            if (!record.positions.length && record.rebateCents === 0) {
                throw new Error("포지션 또는 리베이트를 입력하세요. 전체 삭제는 삭제 버튼을 사용하세요.");
            }

            D.saveTrading(selectedDate, record);
            render();
            toast("트레이딩과 적용 환율을 저장했습니다.");
        } else if (form.id === "plan-form") {
            const plan = readPlan(form);

            D.update(state => {
                state.settings.plan = plan;
            });

            render();
            toast("목표와 배달 요일을 저장했습니다.");
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

            render();
            toast("시작 손실을 저장했습니다.");
        } else if (form.id === "github-form") {
            D.configureGithub({
                owner: form.elements.owner.value.trim(),
                repo: form.elements.repo.value.trim(),
                branch: form.elements.branch.value.trim()
            }, form.elements.token.value.trim());

            dirty = false;
            render();
            toast("GitHub 연결 정보를 저장했습니다.");
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
            if (window.confirm("이 날짜의 배달 기록만 삭제할까요? 트레이딩은 유지됩니다.")) {
                D.saveDelivery(selectedDate, null);
                render();
                toast("배달 기록을 삭제했습니다.");
            }
        } else if (name === "delete-trading") {
            if (window.confirm("이 날짜의 트레이딩 기록만 삭제할까요? 배달은 유지됩니다.")) {
                D.saveTrading(selectedDate, null);
                render();
                toast("트레이딩 기록을 삭제했습니다.");
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
                render();
                toast("저장된 종목명을 변경했습니다.");
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
        } else if (name === "github-pull") {
            if (!window.confirm(
                "원격 기록으로 현재 로컬 기록 전체를 교체합니다.\n" +
                "JSON 백업을 먼저 보관했나요? 계속할까요?"
            )) {
                return;
            }

            await D.pullGithub();
            render();
            toast("원격 기록을 불러왔습니다.");
        } else if (name === "github-push") {
            await D.pushGithub();
            toast("현재 기록을 GitHub에 업로드했습니다.");
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
                const [morning, afternoon] = button.dataset.selectPlan
                    .split(",")
                    .map(Number);

                D.update(state => {
                    state.settings.plan.morning = morning;
                    state.settings.plan.afternoon = afternoon;
                });

                render();
                toast("첫 화면에 표시할 목표로 선택했습니다.");
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
                    `배달 ${count}일, 트레이딩 ${trades}일의 백업으로 교체할까요?\n` +
                    "현재 로컬 기록은 교체됩니다."
                )) {
                    target.value = "";
                    return;
                }

                D.replace(restored);
                ready = true;
                view = "settings";
                render();
                toast("백업을 복원했습니다.");
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

    try {
        D.init();
        ready = true;
        render();
    } catch (error) {
        console.error(error);

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

    return Object.freeze({ toast });
})();
