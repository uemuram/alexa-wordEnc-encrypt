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
        const speakOutput = 'ようこそ。このスキルではメッセージの暗号化を行います。暗号化したいメッセージをどうぞ。';
        const repromptOutput = '暗号化したいメッセージをどうぞ。';

        u.setState(handlerInput, ACCEPT_MESSAGE);
        u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
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

        // 不適切な言葉がないかチェック
        if (u.isInappropriate(rawMessage)) {
            const speakOutput = `不適切な内容が含まれています。メッセージを見直してください。暗号化したいメッセージをどうぞ。`;
            const repromptOutput = '暗号化したいメッセージをどうぞ。'

            u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
            u.setState(handlerInput, ACCEPT_MESSAGE);
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt(repromptOutput)
                .getResponse();
        }

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
            const repromptOutput = '暗号化したいメッセージをどうぞ。'

            u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
            u.setState(handlerInput, ACCEPT_MESSAGE);
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt(repromptOutput)
                .getResponse();
        } else {
            const speakOutput = `メッセージ「${kanaMessage2}」を暗号化します。解読のための鍵を設定しますか?`;
            const repromptOutput = '解読のための鍵を設定しますか?'

            u.setSessionValue(handlerInput, 'MESSAGE', kanaMessage2);
            u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
            u.setState(handlerInput, CONFIRM_USE_KEY);
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt(repromptOutput)
                .getResponse();
        }
    }
};

// 暗号化用の鍵を要求する
const RequestKeyIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent'
                    && u.checkState(handlerInput, CONFIRM_USE_KEY))
                ||
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'ConfirmUseKeyYesIntent'
                    && u.checkState(handlerInput, CONFIRM_USE_KEY))
            );
    },
    handle(handlerInput) {
        const speakOutput = '鍵に使う4桁の数字を言ってください';
        const repromptOutput = speakOutput;

        u.setState(handlerInput, ACCEPT_KEY);
        u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(repromptOutput)
            .getResponse();
    }
};

// 暗号化用の鍵を受け付け、暗号化する(2)
// ※鍵受付中に、フリーのメッセージが入ってきてしまった場合
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
            const repromptOutput = '鍵に使う4桁の数字を言ってください';

            u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
            console.log(intentName);
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt(repromptOutput)
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
        const repromptOutput = '暗号化結果を読み上げますか?';

        // 文言生成
        let speech = new Speech()
            .say('鍵')
            .sayAs({ "word": key, "interpret": "digits" })
            .say('でメッセージを暗号化し、Alexaアプリのアクティビティーに通知しました。暗号化結果を読み上げますか?')
            .pause('1s');
        cardTitle = '暗号化結果(鍵:' + key + ')';

        // カードメッセージ作成
        let cardWords = [];
        for (let i = 0; i < words.length; i++) {
            cardWords.push(`(${i + 1}) ${words[i].word}`);
        }

        u.setSessionValue(handlerInput, 'ENCRYPTED_WORDS', words);
        u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
        u.setState(handlerInput, CONFIRM_READ);
        return handlerInput.responseBuilder
            .speak(speech.ssml())
            .withSimpleCard(cardTitle, cardWords.join('\n'))
            .reprompt(repromptOutput)
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
                ||
                // 鍵なしで暗号化する場合
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'ConfirmUseKeyNoIntent'
                    && u.checkState(handlerInput, CONFIRM_USE_KEY))
                ||
                // 鍵なしで暗号化する場合(メッセージとして認識された場合)
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AcceptMessageIntent'
                    && u.checkState(handlerInput, CONFIRM_USE_KEY))
            );
    },
    handle(handlerInput) {

        // メッセージとして認識された場合、「はい」「いいえ」相当かどうか判定
        if (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AcceptMessageIntent') {
            let message = Alexa.getSlotValue(handlerInput.requestEnvelope, 'Message');
            console.log("入力(メッセージ?) :" + message);
            // 空白を除去
            message = message.replace(/ /g, '');

            // 「はい」に近い言葉になっているか確認
            if (c.YES_MESSAGES.indexOf(message) != -1) {
                console.log("「はい」と判定");
                const speakOutput = '鍵に使う4桁の数字を言ってください';
                const repromptOutput = speakOutput;

                // 鍵受付状態に遷移
                u.setState(handlerInput, ACCEPT_KEY);
                u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
                return handlerInput.responseBuilder
                    .speak(speakOutput)
                    .reprompt(repromptOutput)
                    .getResponse();
            }

            // 「いいえ」に近い言葉になっているか確認
            if (c.NO_MESSAGES.indexOf(message) == -1) {
                console.log("「いいえ」ではないと判定");
                const repromptOutput = u.getSessionValue(handlerInput, 'REPROMPT_OUTPUT');
                const speakOutput = `想定外の呼び出しが発生しました。` + repromptOutput;
                console.log('想定外呼び出し発生3');
                return handlerInput.responseBuilder
                    .speak(speakOutput)
                    .reprompt(repromptOutput)
                    .getResponse();
            }
            console.log("「いいえ」と判定");
        }

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
        const repromptOutput = '暗号化結果を読み上げますか?';

        u.setSessionValue(handlerInput, 'ENCRYPTED_WORDS', words);
        u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
        u.setState(handlerInput, CONFIRM_READ);

        // カードメッセージ作成
        let cardWords = [];
        for (let i = 0; i < words.length; i++) {
            cardWords.push(`(${i + 1}) ${words[i].word}`);
        }

        return handlerInput.responseBuilder
            .speak(speech.ssml())
            .withSimpleCard(cardTitle, cardWords.join('\n'))
            .reprompt(repromptOutput)
            .getResponse();
    }
};

// 結果化結果読み上げ
const ReadIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent'
                    && u.checkState(handlerInput, CONFIRM_READ))
                ||
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'ConfirmReadYesIntent'
                    && u.checkState(handlerInput, CONFIRM_READ))
            );
    },
    handle(handlerInput) {
        const words = u.getSessionValue(handlerInput, 'ENCRYPTED_WORDS');
        // 文言生成
        let speech = new Speech()
            .say('暗号化結果を読み上げます。')
            .pause('1s');
        for (let i = 0; i < words.length; i++) {
            if (words[i].use_yomi) {
                speech.say(words[i].yomi).pause('0.4s');
            } else {
                speech.say(words[i].word).pause('0.4s');
            }
        }
        speech.say('以上です。もう一度読み上げますか?');
        const repromptOutput = 'もう一度読み上げますか?';

        u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
        return handlerInput.responseBuilder
            .speak(speech.ssml())
            .reprompt(repromptOutput)
            .getResponse();
    }
};

// 終了
const FinishIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent'
                    && u.checkState(handlerInput, CONFIRM_READ))
                ||
                (Alexa.getIntentName(handlerInput.requestEnvelope) === 'ConfirmReadNoIntent'
                    && u.checkState(handlerInput, CONFIRM_READ))
            );
    },
    handle(handlerInput) {
        const speakOutput = 'ご利用ありがとうございました。暗号を解読する方法は、このスキルの説明文をご確認下さい。';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

// 終了(2)
// 終了確認中に、フリーのメッセージが入ってきてしまった場合
const FinishFollowIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AcceptMessageIntent'
            && u.checkState(handlerInput, CONFIRM_READ);
    },
    handle(handlerInput) {
        // メッセージとして認識された場合、「はい」「いいえ」相当かどうか判定
        let message = Alexa.getSlotValue(handlerInput.requestEnvelope, 'Message');
        console.log("入力(メッセージ?) :" + message);
        // 空白を除去
        message = message.replace(/ /g, '');

        if (c.YES_MESSAGES.indexOf(message) != -1) {
            console.log("「はい」と判定");
            const words = u.getSessionValue(handlerInput, 'ENCRYPTED_WORDS');
            // 文言生成
            let speech = new Speech()
                .say('暗号化結果を読み上げます。')
                .pause('1s');
            for (let i = 0; i < words.length; i++) {
                if (words[i].use_yomi) {
                    speech.say(words[i].yomi).pause('0.4s');
                } else {
                    speech.say(words[i].word).pause('0.4s');
                }
            }
            speech.say('以上です。もう一度読み上げますか?');
            const repromptOutput = 'もう一度読み上げますか?';

            u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
            return handlerInput.responseBuilder
                .speak(speech.ssml())
                .reprompt(repromptOutput)
                .getResponse();
        }

        if (c.NO_MESSAGES.indexOf(message) != -1) {
            console.log("「いいえ」と判定");
            const speakOutput = 'ご利用ありがとうございました。暗号を解読する方法は、このスキルの説明文をご確認下さい。';
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .getResponse();
        }

        const repromptOutput = u.getSessionValue(handlerInput, 'REPROMPT_OUTPUT');
        const speakOutput = `想定外の呼び出しが発生しました。` + repromptOutput;
        console.log('想定外呼び出し発生2');
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(repromptOutput)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = `
            このスキルでは、任意のメッセージを暗号化します。スキルの支持に従って暗号化してください。
            暗号化できるメッセージはひらがな${c.ENCRYPT_MESSAGE_LENGTH_LIMIT}文字以内です。
            また、解読のための鍵として4桁の数字を設定することもできます。
            暗号化の結果は複数の単語の組み合わせになります。
            暗号を解読する方法は、このスキルの説明文に記載されていますのでそちらをご確認ください。`;
        let repromptOutput = u.getSessionValue(handlerInput, 'REPROMPT_OUTPUT');

        if (repromptOutput) {
            return handlerInput.responseBuilder
                .speak(speakOutput + repromptOutput)
                .reprompt(repromptOutput)
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .getResponse();
        }
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
        console.log(intentName);

        let repromptOutput = u.getSessionValue(handlerInput, 'REPROMPT_OUTPUT');
        let speakOutput;

        // リプロンプトメッセージがとれなかった場合は、スキルを最初から始める
        if (!repromptOutput) {
            speakOutput = 'ようこそ。このスキルではメッセージの暗号化を行います。暗号化したいメッセージをどうぞ。';
            repromptOutput = '暗号化したいメッセージをどうぞ。';

            u.setState(handlerInput, ACCEPT_MESSAGE);
            u.setSessionValue(handlerInput, 'REPROMPT_OUTPUT', repromptOutput);
            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt(repromptOutput)
                .getResponse();
        }

        console.log('想定外呼び出し発生');
        speakOutput = `想定外の呼び出しが発生しました。` + repromptOutput;
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(repromptOutput)
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
        const repromptOutput = u.getSessionValue(handlerInput, 'REPROMPT_OUTPUT');
        const speakOutput = `エラーが発生しました。` + repromptOutput;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(repromptOutput)
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
        FinishFollowIntentHandler,
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
