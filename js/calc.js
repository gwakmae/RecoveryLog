"use strict";

window.RecoveryLog = window.RecoveryLog || {};

RecoveryLog.Calc = (() => {
    const DAY = 86400000;
    const MAX_WON = 100000000000;
    const MAX_CENTS = 10000000000;
    const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
    const ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

    function integer(value) {
        return Number(value).toLocaleString("ko-KR");
    }

    function won(value) {
        return `${integer(value)}원`;
    }

    function usd(centsValue) {
        const sign = centsValue < 0 ? "-" : "";

        return sign + "$" + (Math.abs(centsValue) / 100).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function safe(value, label = "합계") {
        if (!Number.isSafeInteger(value)) {
            throw new Error(`${label}가 안전하게 계산할 수 있는 범위를 넘었습니다.`);
        }

        return value;
    }

    function sum(values, label = "합계") {
        return values.reduce((total, value) => safe(total + value, label), 0);
    }

    function requiredWon(value) {
        const text = String(value).trim();

        if (!/^\d+$/.test(text)) {
            throw new Error("원화 금액은 쉼표 없는 0 이상의 정수로 입력하세요.");
        }

        const result = Number(text);

        if (!Number.isSafeInteger(result) || result > MAX_WON) {
            throw new Error("원화 금액은 1,000억 원 이하로 입력하세요.");
        }

        return result;
    }

    function optionalWon(value) {
        return String(value).trim() === "" ? null : requiredWon(value);
    }

    function cents(value, signed = true) {
        const text = String(value).trim();
        const pattern = signed
            ? /^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/
            : /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;

        if (!pattern.test(text)) {
            throw new Error("달러 금액은 소수 둘째 자리까지 입력하세요. 손실은 음수입니다.");
        }

        const result = Math.round(Number(text) * 100);

        if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_CENTS) {
            throw new Error("달러 금액이 허용 범위를 넘었습니다.");
        }

        return result === 0 ? 0 : result;
    }

    function rate(value) {
        const text = String(value).trim();

        if (!/^\d+(?:\.\d{1,6})?$/.test(text)) {
            throw new Error("적용 환율을 양수로 입력하세요. 소수점은 최대 6자리입니다.");
        }

        const result = Number(text);

        if (!Number.isFinite(result) || result <= 0 || result > 100000) {
            throw new Error("환율은 0 초과 100,000 이하로 입력하세요.");
        }

        return result;
    }

    function position(raw, number = 1) {
        const symbol = String(raw.symbol ?? "").trim().toUpperCase();
        const lotsText = String(raw.lots ?? "").trim();
        const lots = Number(lotsText);

        if (!symbol || symbol.length > 80) {
            throw new Error(`${number}번 종목은 1~80자로 입력하세요.`);
        }

        if (raw.side !== "Buy" && raw.side !== "Sell") {
            throw new Error(`${number}번 방향은 Buy 또는 Sell이어야 합니다.`);
        }

        if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(lotsText) ||
            !Number.isFinite(lots) || lots <= 0 || lots > 1000000) {
            throw new Error(`${number}번 랏수는 0 초과 1,000,000 이하로 입력하세요.`);
        }

        if (!Number.isSafeInteger(raw.pnlCents) ||
            Math.abs(raw.pnlCents) > MAX_CENTS) {
            throw new Error(`${number}번 손익을 확인하세요.`);
        }

        let ticket = null;

        if (raw.ticket !== null && raw.ticket !== undefined && raw.ticket !== "") {
            if (typeof raw.ticket !== "string" || raw.ticket.trim().length > 100) {
                throw new Error(`${number}번 거래번호를 확인하세요.`);
            }

            ticket = raw.ticket.trim() || null;
        }

        return {
            symbol,
            side: raw.side,
            lots,
            pnlCents: raw.pnlCents,
            ticket
        };
    }

    function validDate(key) {
        if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
            throw new Error("유효한 날짜를 선택하세요.");
        }

        const year = Number(key.slice(0, 4));

        if (year < 1900 || year > 9999) {
            throw new Error("날짜는 1900년부터 9999년까지 허용합니다.");
        }

        const date = new Date(`${key}T00:00:00.000Z`);

        if (!Number.isFinite(date.getTime()) ||
            date.toISOString().slice(0, 10) !== key) {
            throw new Error("존재하지 않는 날짜입니다.");
        }

        return key;
    }

    function today() {
        const now = new Date();

        return now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, "0") + "-" +
            String(now.getDate()).padStart(2, "0");
    }

    function recordDate(key) {
        validDate(key);

        if (key > today()) {
            throw new Error("미래 날짜에는 실제 수입을 저장할 수 없습니다.");
        }

        return key;
    }

    function epoch(key) {
        validDate(key);
        return Date.parse(`${key}T00:00:00.000Z`) / DAY;
    }

    function fromEpoch(value) {
        const date = new Date(value * DAY);

        if (!Number.isFinite(date.getTime()) ||
            date.getUTCFullYear() < 1900 ||
            date.getUTCFullYear() > 9999) {
            return null;
        }

        return date.toISOString().slice(0, 10);
    }

    function addDays(key, days) {
        if (!Number.isSafeInteger(days)) {
            throw new Error("날짜 이동값이 올바르지 않습니다.");
        }

        const result = fromEpoch(epoch(key) + days);

        if (!result) {
            throw new Error("날짜 표시 범위를 넘었습니다.");
        }

        return result;
    }

    function weekday(key) {
        validDate(key);
        return new Date(`${key}T00:00:00.000Z`).getUTCDay();
    }

    function dateLabel(key) {
        validDate(key);
        return `${key} (${WEEKDAYS[weekday(key)]})`;
    }

    function monthLast(first) {
        validDate(first);

        const year = Number(first.slice(0, 4));
        const month = Number(first.slice(5, 7));
        const last = new Date(Date.UTC(year, month, 0));

        return last.toISOString().slice(0, 10);
    }

    function validWeekdays(value) {
        if (!Array.isArray(value) || !value.length ||
            value.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
            new Set(value).size !== value.length) {
            throw new Error("배달 요일을 하나 이상 선택하세요.");
        }

        return value.slice().sort((a, b) => a - b);
    }

    function plan(raw) {
        const legacy = raw.daily === undefined;

        const daily = legacy
            ? safe(
                requiredWon(raw.morning) + requiredWon(raw.afternoon),
                "기존 하루 목표"
            )
            : requiredWon(raw.daily);

        if (daily <= 0) {
            throw new Error("하루 배달 목표는 0원보다 커야 합니다.");
        }

        const start = validDate(raw.start);
        const deadline =
            raw.deadline === null ||
            raw.deadline === undefined ||
            raw.deadline === ""
                ? null
                : validDate(raw.deadline);

        if (deadline && deadline < start) {
            throw new Error("목표 완료일은 설정한 시작일보다 빠를 수 없습니다.");
        }

        return {
            daily,
            start,
            deadline
        };
    }

    function effectiveStart(start, reference = today()) {
        const tomorrow = addDays(reference, 1);

        return start > tomorrow ? validDate(start) : tomorrow;
    }

    function tradeDay(record) {
        const pnlCents = sum(
            record.positions.map(item => item.pnlCents),
            "트레이딩 손익"
        );

        const trading = safe(Math.round(pnlCents * record.rate / 100));
        const rebate = safe(Math.round(record.rebateCents * record.rate / 100));

        return {
            pnlCents,
            trading,
            rebate,
            total: safe(trading + rebate)
        };
    }

    function hasDelivery(record) {
        if (!record) {
            return false;
        }

        if (record.mode === "detail") {
            return record.coupang !== null && record.coupang !== undefined ||
                record.baemin !== null && record.baemin !== undefined;
        }

        if (record.mode === "combined") {
            return record.combined !== null && record.combined !== undefined;
        }

        return record.morning !== null && record.morning !== undefined ||
            record.afternoon !== null && record.afternoon !== undefined;
    }

    function deliveryAmount(record) {
        if (!record) {
            return 0;
        }

        if (record.mode === "detail") {
            return safe(
                (record.coupang ?? 0) + (record.baemin ?? 0),
                "배달 합계"
            );
        }

        if (record.mode === "combined") {
            return safe(record.combined ?? 0, "배달 합계");
        }

        return safe(
            (record.morning ?? 0) + (record.afternoon ?? 0),
            "기존 배달 합계"
        );
    }

    function totals(state, monthPrefix = null) {
        let delivery = 0;
        let other = 0;
        let trading = 0;
        let rebate = 0;
        let deliveryDays = 0;

        Object.entries(state.deliveries).forEach(([date, record]) => {
            if (monthPrefix && !date.startsWith(monthPrefix + "-")) {
                return;
            }

            delivery = safe(delivery + deliveryAmount(record));
            other = safe(other + (record.other ?? 0));

            if (hasDelivery(record)) {
                deliveryDays += 1;
            }
        });

        Object.entries(state.trading).forEach(([date, record]) => {
            if (monthPrefix && !date.startsWith(monthPrefix + "-")) {
                return;
            }

            const result = tradeDay(record);

            trading = safe(trading + result.trading);
            rebate = safe(rebate + result.rebate);
        });

        return {
            delivery,
            other,
            trading,
            rebate,
            recovered: sum([delivery, other, trading, rebate]),
            deliveryDays
        };
    }

    function deliveryAverage(deliveries) {
        const records = Object.values(deliveries).filter(hasDelivery);
        const total = sum(records.map(deliveryAmount));

        return {
            total,
            days: records.length,
            average: records.length
                ? Math.floor(total / records.length)
                : 0
        };
    }

    function countWorkDays(start, end, weekdays) {
        validDate(start);
        validDate(end);

        const selected = validWeekdays(weekdays);
        const days = epoch(end) - epoch(start) + 1;

        if (days <= 0) {
            return 0;
        }

        const fullWeeks = Math.floor(days / 7);
        let count = fullWeeks * selected.length;
        const startDay = weekday(start);

        for (let index = 0; index < days % 7; index += 1) {
            if (selected.includes((startDay + index) % 7)) {
                count += 1;
            }
        }

        return count;
    }

    function finishDate(start, workDays, weekdays) {
        validDate(start);
        const selected = validWeekdays(weekdays);

        if (!Number.isSafeInteger(workDays) || workDays < 1) {
            throw new Error("필요 배달 일수는 1 이상의 정수여야 합니다.");
        }

        let firstOffset = 0;
        const startDay = weekday(start);

        while (!selected.includes((startDay + firstOffset) % 7)) {
            firstOffset += 1;
        }

        const fullWeeks = Math.floor((workDays - 1) / selected.length);
        let targetEpoch = epoch(start) + firstOffset + fullWeeks * 7;
        let remaining = (workDays - 1) % selected.length;
        let day = (startDay + firstOffset) % 7;

        while (remaining > 0) {
            targetEpoch += 1;
            day = (day + 1) % 7;

            if (selected.includes(day)) {
                remaining -= 1;
            }
        }

        return fromEpoch(targetEpoch);
    }

    function project(remaining, daily, start, weekdays) {
        safe(remaining, "남은 손실");
        safe(daily, "하루 목표");
        validDate(start);
        validWeekdays(weekdays);

        if (remaining <= 0) {
            return { workDays: 0, finish: null, calendarDays: 0 };
        }

        if (daily <= 0) {
            return { workDays: null, finish: null, calendarDays: null };
        }

        const workDays = Math.ceil(remaining / daily);
        const finish = finishDate(start, workDays, weekdays);

        return {
            workDays,
            finish,
            calendarDays: finish ? epoch(finish) - epoch(start) + 1 : null
        };
    }

    function reverse(remaining, start, deadline, weekdays = ALL_DAYS) {
        safe(remaining, "남은 손실");

        const availableDays = countWorkDays(start, deadline, weekdays);

        if (remaining <= 0) {
            return {
                availableDays,
                requiredDaily: 0
            };
        }

        if (availableDays === 0) {
            return {
                availableDays,
                requiredDaily: null
            };
        }

        return {
            availableDays,
            requiredDaily: Math.ceil(remaining / availableDays)
        };
    }

    return Object.freeze({
        MAX_WON,
        MAX_CENTS,
        ALL_DAYS,
        integer,
        won,
        usd,
        safe,
        sum,
        requiredWon,
        optionalWon,
        cents,
        rate,
        position,
        validDate,
        today,
        recordDate,
        addDays,
        weekday,
        dateLabel,
        monthLast,
        plan,
        effectiveStart,
        tradeDay,
        hasDelivery,
        deliveryAmount,
        totals,
        deliveryAverage,
        countWorkDays,
        finishDate,
        project,
        reverse
    });
})();