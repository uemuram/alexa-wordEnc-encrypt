// This sample demonstrates handling intents from an Alexa skill using the Alexa Skills Kit SDK (v2).
// Please visit https://alexa.design/cookbook for additional examples on implementing slots, dialog management,
// session persistence, api calls, and more.
const Alexa = require('ask-sdk-core');
const Axios = require('axios');
const AWS = require('aws-sdk');
const CommonUtil = require('/opt/CommonUtil');
const cu = new CommonUtil();

const API_URL = 'https://labs.goo.ne.jp/api/hiragana';

// ステータス
const ACCEPT_MESSAGE = 0;
const CONFIRM_USE_KEY = 1;
const ACCEPT_KEY = 2;

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        const speakOutput = 'ようこそ。暗号化したいメッセージをどうぞ。';
        //const speakOutput = 'ようこそ。このスキルではメッセージの暗号化を行います。暗号化したいメッセージをどうぞ。';
        const repromptOutput = '暗号化したいメッセージをどうぞ。'

        cu.setState(handlerInput, ACCEPT_MESSAGE);
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
            && cu.checkState(handlerInput, ACCEPT_MESSAGE);
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
        const speakOutput = `メッセージ「${kanaMessage}」を暗号化します。複合のための鍵を設定しますか?`;

        cu.setState(handlerInput, CONFIRM_USE_KEY);
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .withSimpleCard('暗号化メッセージ', kanaMessage)
            .reprompt('複合のための鍵を設定しますか?')
            .getResponse();
    }
};

// 暗号化用の鍵を要求する
const RequestKeyIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent'
            && cu.checkState(handlerInput, CONFIRM_USE_KEY);
    },
    handle(handlerInput) {
        const speakOutput = '鍵に使う4桁の数字を言ってください';

        cu.setState(handlerInput, ACCEPT_KEY);
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

// 暗号化用の鍵を受け付ける
const AcceptKeyIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AcceptKeyIntent'
            && cu.checkState(handlerInput, ACCEPT_KEY);
    },
    handle(handlerInput) {
        let key = Alexa.getSlotValue(handlerInput.requestEnvelope, 'Key');
        console.log("鍵 :" + key)
        // TODO https://developer.amazon.com/ja-JP/docs/alexa/custom-skills/speech-synthesis-markup-language-ssml-reference.html
        // digits
        const speakOutput = '鍵を' + key + 'で受け付けました';
        return handlerInput.responseBuilder
            .speak(speakOutput)
            //            .reprompt(speakOutput)
            .getResponse();
    }
};

const NoIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'noですね。';
        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
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
        const speakOutput = 'Goodbye!';
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
        const speakOutput = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
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
        const speakOutput = `Sorry, I had trouble doing what you asked. Please try again.`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
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
        NoIntentHandler,
        AcceptMessageIntentHandler,
        RequestKeyIntentHandler,
        AcceptKeyIntentHandler,
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
