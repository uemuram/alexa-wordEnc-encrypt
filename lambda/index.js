// This sample demonstrates handling intents from an Alexa skill using the Alexa Skills Kit SDK (v2).
// Please visit https://alexa.design/cookbook for additional examples on implementing slots, dialog management,
// session persistence, api calls, and more.
const Alexa = require('ask-sdk-core');
const Axios = require('axios');
const AWS = require('aws-sdk');
const Speech = require('ssml-builder');
const CommonUtil = require('/opt/CommonUtil');
const u = new CommonUtil();
const Constant = require('/opt/Constant');
const c = new Constant();

const API_URL = 'https://labs.goo.ne.jp/api/hiragana';

// ステータス
const ACCEPT_MESSAGE = 0;
const CONFIRM_USE_KEY = 1;
const ACCEPT_KEY = 2;
const CONFIRM_READ = 3;

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        const speakOutput = 'ようこそ。暗号化したいメッセージをどうぞ。';
        //const speakOutput = 'ようこそ。このスキルではメッセージの暗号化を行います。暗号化したいメッセージをどうぞ。';
        const repromptOutput = '暗号化したいメッセージをどうぞ。'

        u.setState(handlerInput, ACCEPT_MESSAGE);
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(repromptOutput)
            .getResponse();
    }
};

// 暗号化対象メッセージの受付
const AcceptMessageIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AcceptMessageIntent'
            && u.checkState(handlerInput, ACCEPT_MESSAGE);
    },
    async handle(handlerInput) {
        //let rawMessage = handlerInput.requestEnvelope.request.intent.slots.Message.value;
        let rawMessage = Alexa.getSlotValue(handlerInput.requestEnvelope, 'Message');
        console.log(`生メッセージ: "${rawMessage}"`);
        let kanaMessage;

        try {
            // API用のキーを取得
            const ssm = new AWS.SSM();
            const request = {
                Name: 'ALEXA-WORDENC-GOOAPI-KEY',
                WithDecryption: true
            };
            const response = await ssm.getParameter(request).promise();
            const apiKey = response.Parameter.Value;

            // ひらがな変換
            const res = await Axios.post(API_URL, {
                app_id: apiKey,
                output_type: 'hiragana',
                sentence: rawMessage
            });
            kanaMessage = res.data.converted;
            console.log(`変換後メッセージ: "${kanaMessage}"`);

        } catch (error) {
            throw new Error(`http get error: ${error}`);
        }

        // 対応していない文字があった場合は除外する
        let kanaMessage2 = ''
        for (let i = 0; i < kanaMessage.length; i++) {
            if (c.kanaList.indexOf(kanaMessage[i]) >= 0) {
                kanaMessage2 += kanaMessage[i];
            }
        }
        console.log(`不要文字除去後メッセージ: "${kanaMessage2}"`);

        // 文字数の上限を超えていないかチェック
        if (kanaMessage2.length > c.ENCRYPT_MESSAGE_LENGTH_LIMIT) {
            const speakOutput = `メッセージが長すぎます。${c.ENCRYPT_MESSAGE_LENGTH_LIMIT}文字以内になるようにして下さい。`;
            u.setState(handlerInput, ACCEPT_MESSAGE);
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt('暗号化したいメッセージをどうぞ。')
                .getResponse();
        } else {
            const speakOutput = `メッセージ「${kanaMessage2}」を暗号化します。複合のための鍵を設定しますか?`;
            u.setSessionValue(handlerInput, 'MESSAGE', kanaMessage2);
            u.setState(handlerInput, CONFIRM_USE_KEY);
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .withSimpleCard('暗号化メッセージ', kanaMessage2)
                .reprompt('複合のための鍵を設定しますか?')
                .getResponse();
        }
    }
};

// 暗号化用の鍵を要求する
const RequestKeyIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent'
            && u.checkState(handlerInput, CONFIRM_USE_KEY);
    },
    handle(handlerInput) {
        const speakOutput = '鍵に使う4桁の数字を言ってください';

        u.setState(handlerInput, ACCEPT_KEY);
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

// 暗号化用の鍵を受け付け、暗号化する(2)
// ※鍵受付中に、フリーのメッセージが入ってきたしまった場合
const AcceptKeyFollowIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AcceptMessageIntent'
            && u.checkState(handlerInput, ACCEPT_KEY);
    },
    handle(handlerInput) {
        // 鍵(4桁の数値)になっているかチェック
        let key = Alexa.getSlotValue(handlerInput.requestEnvelope, 'Message');
        console.log("入力(鍵?) :" + key);
        // 空白を除去
        key = key.replace(/ /g, '');
        // "5"が「号」になるパターンがあるので補正
        key = key.replace(/号/g, '5');
        console.log("入力(補正後) :" + key);

        // 補正した上で「4桁の数字」にならなけばエラー返却
        if (!key.match(/^[0-9]{4}$/)) {
            const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
            const speakOutput = `鍵を認識できませんでした。4桁の数字を言ってください。`;
            console.log(intentName);
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt('鍵に使う4桁の数字を言ってください')
                .getResponse();
        }

        // 4桁の数字と判定されたため処理継続
        // 鍵の調整
        let intKey = parseInt(key);
        console.log("鍵 :" + key);
        console.log("鍵(int) :" + intKey);

        // 暗号化処理呼び出し
        const message = u.getSessionValue(handlerInput, 'MESSAGE');
        const words = u.encrypt(intKey, message);
        console.log("暗号 :", words);

        // 文言生成
        let speech = new Speech()
            .say('鍵')
            .sayAs({ "word": key, "interpret": "digits" })
            .say('でメッセージを暗号化し、Alexaアプリのアクティビティーに通知しました。暗号化結果を読み上げますか?')
            .pause('1s');
        cardTitle = '暗号化結果(鍵:' + key + ')';

        u.setSessionValue(handlerInput, 'ENCRYPTED_WORDS', words);
        u.setState(handlerInput, CONFIRM_READ);
        return handlerInput.responseBuilder
            .speak(speech.ssml())
            .withSimpleCard(cardTitle, words.join('\n'))
            .reprompt('暗号化結果を読み上げますか?')
            .getResponse();
    }
};

// 暗号化する
const EncryptIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (
                // 鍵ありで暗号化する場合
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AcceptKeyIntent'
                    && u.checkState(handlerInput, ACCEPT_KEY))
                ||
                // 鍵なしで暗号化する場合
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent'
                    && u.checkState(handlerInput, CONFIRM_USE_KEY))
            );
    },
    handle(handlerInput) {

        // 鍵の有無で分岐
        let intKey;
        let speech = new Speech();
        let cardTitle;
        if (u.checkState(handlerInput, ACCEPT_KEY)) {
            // 鍵ありの場合
            let key = Alexa.getSlotValue(handlerInput.requestEnvelope, 'Key');
            intKey = parseInt(key);
            console.log('鍵 :' + key);
            console.log('鍵(int) :' + intKey);
            speech.say('鍵')
                .sayAs({ "word": key, "interpret": "digits" })
                .say('でメッセージを暗号化し、Alexaアプリのアクティビティーに通知しました。暗号化結果を読み上げますか?')
                .pause('1s');
            cardTitle = '暗号化結果(鍵:' + key + ')';
        } else {
            // 鍵なしの場合
            intKey = c.DEFAULT_RANDOMKEY;
            console.log('鍵(デフォルト) :' + intKey);
            speech.say('鍵なしでメッセージを暗号化し、Alexaアプリのアクティビティーに通知しました。暗号化結果を読み上げますか?')
                .pause('1s');
            cardTitle = '暗号化結果(鍵なし)';
        }

        // 暗号化処理呼び出し
        const message = u.getSessionValue(handlerInput, 'MESSAGE');
        const words = u.encrypt(intKey, message);
        console.log("暗号 :", words);

        u.setSessionValue(handlerInput, 'ENCRYPTED_WORDS', words);
        u.setState(handlerInput, CONFIRM_READ);
        return handlerInput.responseBuilder
            .speak(speech.ssml())
            .withSimpleCard(cardTitle, words.join('\n'))
            .reprompt('暗号化結果を読み上げますか?')
            .getResponse();
    }
};

// 結果化結果読み上げ
const ReadIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent'
            && u.checkState(handlerInput, CONFIRM_READ);
    },
    handle(handlerInput) {
        const words = u.getSessionValue(handlerInput, 'ENCRYPTED_WORDS');
        // 文言生成
        let speech = new Speech()
            .say('暗号化結果を読み上げます。')
            .pause('1s');
        for (let i = 0; i < words.length; i++) {
            speech.say(words[i]).pause('0.4s');
        }
        speech.say('以上です。もう一度読み上げますか?');

        return handlerInput.responseBuilder
            .speak(speech.ssml())
            .reprompt('もう一度読み上げますか?')
            .getResponse();
    }
};

// 終了
const FinishIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent'
            && u.checkState(handlerInput, CONFIRM_READ);
    },
    handle(handlerInput) {
        const speakOutput = 'ご利用ありがとうございました。暗号を解読するには、姉妹スキルの「解読くん」をご利用下さい。';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'You can say hello to me! How can I help?';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speakOutput = 'ご利用ありがとうございました。';
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse();
    }
};

// The intent reflector is used for interaction model testing and debugging.
// It will simply repeat the intent the user said. You can create custom handlers
// for your intents by defining them above, then also adding them to the request
// handler chain below.
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `想定外の呼び出しが発生しました。もう一度お試しください。`;
        console.log(intentName);
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt('もう一度お試しください。')
            .getResponse();
    }
};

// Generic error handling to capture any syntax or routing errors. If you receive an error
// stating the request handler chain is not found, you have not implemented a handler for
// the intent being invoked or included it in the skill builder below.
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`~~~~ Error handled: ${error.stack}`);
        const speakOutput = `エラーが発生しました。もう一度お試しください。`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt("もう一度お試しください。")
            .getResponse();
    }
};

// リクエストインターセプター(エラー調査用)
const RequestLog = {
    process(handlerInput) {
        //console.log("REQUEST ENVELOPE = " + JSON.stringify(handlerInput.requestEnvelope));
        console.log("HANDLER INPUT = " + JSON.stringify(handlerInput));
        const requestType = Alexa.getRequestType(handlerInput.requestEnvelope);
        console.log("REQUEST TYPE =  " + requestType);
        if (requestType === 'IntentRequest') {
            console.log("INTENT NAME =  " + Alexa.getIntentName(handlerInput.requestEnvelope));
        }
        return;
    }
};

// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        AcceptMessageIntentHandler,
        RequestKeyIntentHandler,
        AcceptKeyFollowIntentHandler,
        EncryptIntentHandler,
        ReadIntentHandler,
        FinishIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler, // make sure IntentReflectorHandler is last so it doesn't override your custom intent handlers
    )
    .addErrorHandlers(
        ErrorHandler,
    )
    .addRequestInterceptors(RequestLog)
    .lambda();
