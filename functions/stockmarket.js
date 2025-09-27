// /functions/stockmarket.js (신규 파일)
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { logger } = require('firebase-functions');

module.exports = (admin, { onCall, HttpsError, logger, onSchedule }) => {
    const db = admin.firestore();
    const { FieldValue } = admin.firestore;

    // TODO: AI 뉴스 생성을 위한 Gemini 호출 헬퍼 함수 구현 필요

    // 15분마다 주식 시장을 업데이트하는 스케줄러
    const updateStockMarket = onSchedule({
        schedule: "every 15 minutes",
        region: 'us-central1'
    }, async (event) => {
        logger.info("Running scheduled stock market update...");

        const stocksRef = db.collection('stocks');
        const stocksMasterSnap = await db.doc('configs/stocks').get();
        const stocksMaster = stocksMasterSnap.exists() ? stocksMasterSnap.data().stocks_master : [];
        
        const stocksSnap = await stocksRef.where('status', '==', 'listed').get();

        for (const doc of stocksSnap.docs) {
            const stock = doc.data();
            const master = stocksMaster.find(s => s.id === doc.id);
            if (!master) continue;

            // 로직: 15분 주기 = 1. 다음 이벤트 결정 -> 2. 뉴스 생성 -> 3. 가격 반영 (3단계 순환)
            if (!stock.upcoming_event) {
                // 1. 다음 이벤트 미리 결정 (상승/하락/보합)
                const directions = ['up', 'down', 'stable'];
                const magnitudes = ['small', 'medium', 'large'];
                // TODO: master.volatility에 따라 확률 가중치 부여
                const nextEvent = {
                    change_direction: directions[Math.floor(Math.random() * directions.length)],
                    magnitude: magnitudes[Math.floor(Math.random() * magnitudes.length)],
                    news_generated: false
                };
                await doc.ref.update({ upcoming_event: nextEvent });

            } else if (!stock.upcoming_event.news_generated) {
                // 2. AI 뉴스 생성 및 메일 발송 (현재는 더미 데이터)
                const aiNews = { title: "새로운 소식!", body: `${stock.name}에 대한 흥미로운 변화가 감지되었습니다.` };

                const mailPromises = (stock.subscribers || []).map(uid => {
                    const mailRef = db.collection('mail').doc(uid).collection('msgs').doc();
                    return mailRef.set({
                        kind: 'etc',
                        title: `[주식 속보] ${stock.name}`,
                        body: `${aiNews.title}\n\n${aiNews.body}`,
                        sentAt: FieldValue.serverTimestamp(),
                        from: '증권 정보국',
                        read: false,
                        attachments: { ref_type: 'stock', ref_id: doc.id }
                    });
                });
                await Promise.all(mailPromises);
                await doc.ref.update({ 'upcoming_event.news_generated': true });

            } else {
                // 3. 실제 가격 반영 및 이벤트 초기화
                const currentPrice = stock.current_price || 100;
                let fluctuation = 0;
                // TODO: upcoming_event 내용에 따라 변동률 계산
                const newPrice = Math.max(1, Math.round(currentPrice * (1 + fluctuation)));

                const priceHistory = (stock.price_history || []).slice(-29);
                priceHistory.push({ date: new Date().toISOString(), price: newPrice });
                
                await doc.ref.update({
                    current_price: newPrice,
                    price_history: priceHistory,
                    upcoming_event: null
                });
            }
        }
        logger.info(`Stock market updated for ${stocksSnap.size} stocks.`);
    });

    // TODO: buyStock, sellStock, subscribeToStock, createGuildStock, distributeDividends 함수 구현

    return {
        updateStockMarket,
    };
};
