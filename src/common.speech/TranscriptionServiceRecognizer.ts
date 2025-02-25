// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import {
    IAudioSource,
    IConnection,
    MessageType
} from "../common/Exports";
import {
    CancellationErrorCode,
    CancellationReason,
    ConversationTranscriptionCanceledEventArgs,
    PropertyCollection,
    PropertyId,
    ResultReason,
    SpeechRecognitionEventArgs,
    SpeechRecognitionResult,
} from "../sdk/Exports";
import { ConversationInfo } from "../sdk/Transcription/Exports";
import { ConversationProperties } from "../sdk/Transcription/IConversation";
import {
    CancellationErrorCodePropertyName,
    ConversationServiceRecognizer,
    TranscriberRecognizer
} from "./Exports";
import { IAuthentication } from "./IAuthentication";
import { IConnectionFactory } from "./IConnectionFactory";
import { RecognizerConfig } from "./RecognizerConfig";
import { SpeechConnectionMessage } from "./SpeechConnectionMessage.Internal";

// eslint-disable-next-line max-classes-per-file
export class TranscriptionServiceRecognizer extends ConversationServiceRecognizer {

    private privTranscriberRecognizer: TranscriberRecognizer;

    public constructor(
        authentication: IAuthentication,
        connectionFactory: IConnectionFactory,
        audioSource: IAudioSource,
        recognizerConfig: RecognizerConfig,
        transcriber: TranscriberRecognizer) {
        super(authentication, connectionFactory, audioSource, recognizerConfig, transcriber);
        this.privTranscriberRecognizer = transcriber;
        this.sendPrePayloadJSONOverride = (connection: IConnection): Promise<void> => this.sendTranscriptionStartJSON(connection);
        if (this.privRecognizerConfig.parameters.getProperty(PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps) === "true") {
            this.privSpeechContext.setWordLevelTimings();
        }
    }

    public async sendSpeechEventAsync(info: ConversationInfo, command: string): Promise<void> {
        if (!!this.privRequestSession.isRecognizing) {
            const connection: IConnection = await this.fetchConnection();
            await this.sendSpeechEvent(connection, this.createSpeechEventPayload(info, command));
        }
    }

    protected processTypeSpecificMessages(connectionMessage: SpeechConnectionMessage): Promise<boolean> {
        return this.processSpeechMessages(connectionMessage);
    }

    protected handleRecognizedCallback(result: SpeechRecognitionResult, offset: number, sessionId: string): void {
        try {
            const event: SpeechRecognitionEventArgs = new SpeechRecognitionEventArgs(result, offset, sessionId);
            this.privTranscriberRecognizer.recognized(this.privTranscriberRecognizer, event);
            if (!!this.privSuccessCallback) {
                try {
                    this.privSuccessCallback(result);
                } catch (e) {
                    if (!!this.privErrorCallback) {
                        this.privErrorCallback(e as string);
                    }
                }
                // Only invoke the call back once.
                // and if it's successful don't invoke the
                // error after that.
                this.privSuccessCallback = undefined;
                this.privErrorCallback = undefined;
            }
        /* eslint-disable no-empty */
        } catch (error) {
            // Not going to let errors in the event handler
            // trip things up.
        }
    }

    protected handleRecognizingCallback(result: SpeechRecognitionResult, duration: number, sessionId: string): void {
        try {
            const ev = new SpeechRecognitionEventArgs(result, duration, sessionId);
            this.privTranscriberRecognizer.recognizing(this.privTranscriberRecognizer, ev);
            /* eslint-disable no-empty */
        } catch (error) {
            // Not going to let errors in the event handler
            // trip things up.
        }
    }

    // Cancels recognition.
    protected cancelRecognition(
        sessionId: string,
        requestId: string,
        cancellationReason: CancellationReason,
        errorCode: CancellationErrorCode,
        error: string): void {

        const properties: PropertyCollection = new PropertyCollection();
        properties.setProperty(CancellationErrorCodePropertyName, CancellationErrorCode[errorCode]);

        if (!!this.privTranscriberRecognizer.canceled) {
            const cancelEvent: ConversationTranscriptionCanceledEventArgs = new ConversationTranscriptionCanceledEventArgs(
                cancellationReason,
                error,
                errorCode,
                undefined,
                sessionId);
            try {
                this.privTranscriberRecognizer.canceled(this.privTranscriberRecognizer, cancelEvent);
                /* eslint-disable no-empty */
            } catch { }
        }

        if (!!this.privSuccessCallback) {
            const result: SpeechRecognitionResult = new SpeechRecognitionResult(
                requestId,
                ResultReason.Canceled,
                undefined, // Text
                undefined, // Duration
                undefined, // Offset
                undefined, // Language
                undefined, // Language Detection Confidence
                undefined, // Speaker Id
                error,
                undefined, // Json
                properties);
            try {
                this.privSuccessCallback(result);
                this.privSuccessCallback = undefined;
                /* eslint-disable no-empty */
            } catch { }
        }
    }

    // Encapsulated for derived service recognizers that need to send additional JSON
    protected async sendTranscriptionStartJSON(connection: IConnection): Promise<void> {
        await this.sendSpeechContext(connection, true);
        const info: ConversationInfo = this.privTranscriberRecognizer.getConversationInfo();
        const payload: { [id: string]: any } = this.createSpeechEventPayload(info, "start");
        await this.sendSpeechEvent(connection, payload);
        await this.sendWaveHeader(connection);
        return;
    }

    protected sendSpeechEvent(connection: IConnection, payload: { [id: string]: any }): Promise<void> {
        const speechEventJson = JSON.stringify(payload);

        if (speechEventJson) {
            return connection.send(new SpeechConnectionMessage(
                MessageType.Text,
                "speech.event",
                this.privRequestSession.requestId,
                "application/json",
                speechEventJson));
        }
        return;
    }

    private createSpeechEventPayload(info: ConversationInfo, command: string): { [id: string]: any } {
        const eventDict: { id: string; name: string; meeting: ConversationProperties } = { id: "meeting", name: command, meeting: info.conversationProperties };
        eventDict.meeting.id = info.id;
        eventDict.meeting.attendees = info.participants;
        eventDict.meeting.record = info.conversationProperties.audiorecording === "on" ? "true" : "false";
        return eventDict;
    }
}
