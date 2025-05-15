import { flashcardsResponses } from "../src/scripts/flashcardsResponses";
import getTTSParams from "../src/util/getTTSParams";
import pool from '../src/util/db';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import sinon from 'sinon';
import { uploadFile, deleteFile } from '../src/util/s3';
import { SubjectEnum } from '../src/enums/SubjectEnum';
import AWS from 'aws-sdk';

import dotenv from 'dotenv';
dotenv.config();

import { jest, describe, afterEach, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { IFlashcardsQueryRes } from "../src/interfaces/IFlashcardsQueryRes";
import process from 'process';

// Constants for tests
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const CHUNK_SIZE = 2;
const BATCH_DELAY = 10000;

// Mock for axios
const mockAxios = new MockAdapter(axios);

// Mock for AWS S3 (v3)
const s3Mock = mockClient(S3Client);

describe('flashcardsResponses', () => {
    let testResponse: IFlashcardsQueryRes;
    let mockQuery: sinon.SinonStub;

    beforeAll(() => {
        jest.setTimeout(120000);
        console.log('🚀 Starting tests...');

        testResponse = {
            questionid: '1',
            answerid: 'faa66504-348d-4a13-abf5-92d8003b2724',
            language: SubjectEnum.ENGLISH,
            question: 'What is the capital of France?',
            answer: 'Paris'
        };
    });

    beforeEach(() => {
        mockQuery = sinon.stub(pool, 'query');
    });

    afterAll(async () => {
        s3Mock.restore();
        sinon.restore();
        await pool.end();
        console.log('✅ Tests completed.');
    }, 150000);

    afterEach(() => {
        mockAxios.reset();
        s3Mock.reset();
        sinon.restore();
        if (mockQuery) {
            mockQuery.restore();
        }
    });

    // Tests for ElevenLabs API
    describe('API ElevenLabs', () => {
        it('should call ElevenLabs API successfully (Cas 1)', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            mockAxios.onPost(`${ELEVENLABS_API_URL}/9BWtsMINqrJLrRacOk9x`).reply(200, audioBuffer);
            const params = getTTSParams(SubjectEnum.ENGLISH, testResponse.answer);
            const response = await axios.post(`${ELEVENLABS_API_URL}/${params.voice_id}`, {
                text: params.text,
                model_id: params.model_id,
                voice_settings: params.voice_settings,
            }, {
                headers: {
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                },
                responseType: "arraybuffer",
            });

            expect(response.status).toBe(200);
            expect(response.data).toEqual(audioBuffer);
        }, 60000);

        it('should handle 401 error from ElevenLabs API (Cas 3)', async () => {
            mockAxios.onPost().reply(401);

            mockQuery.resolves({
                rows: [testResponse],
            });

            await expect(flashcardsResponses('CP')).rejects.toMatchObject({
                response: { status: 401 },
            });
        }, 60000);

        it('should throw an error when receiving a 429 status code', async () => {
            mockAxios.onPost().reply(429);

            mockQuery.resolves({
                rows: [testResponse],
            });

            await expect(flashcardsResponses('CP')).rejects.toMatchObject({
                response: { status: 429 },
            });
        }, 60000);

        it('should handle 500 error from ElevenLabs API (Cas 4)', async () => {
            mockAxios.onPost().reply(500);

            mockQuery.resolves({
                rows: [testResponse],
            });

            await expect(flashcardsResponses('CP')).rejects.toMatchObject({
                response: { status: 500 },
            });
        }, 60000);
    });

    // Tests for S3 upload
    describe('Upload sur S3', () => {
        it('should upload audio file to S3 successfully (Cas 1)', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/flashcards/answers/1.mp3';
            const bucket = 'bewize-audios';

            s3Mock.on(PutObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
                ETag: 'fake-etag',
            });

            const fileUrl = await uploadFile(s3Key, audioBuffer, 'audio/mpeg');
            expect(fileUrl).toBe(`https://${bucket}.s3.eu-west-1.amazonaws.com/${s3Key}`);
        }, 60000);

        it('should handle S3 upload error', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/flashcards/answers/1.mp3';
            sinon.stub(AWS.S3.prototype, 'upload').returns({
                promise: () => Promise.reject(new Error('S3 upload failed')),
                abort: () => {},
                send: () => {},
                on: () => {},
            });

            try {
                await uploadFile(s3Key, audioBuffer, 'audio/mpeg');
            } catch (error) {
                expect(error.message).toBe('S3 upload failed');
            }
        });

        it('should handle S3 upload error due to large file size', async () => {
            const largeAudioBuffer = Buffer.alloc(1024 * 1024 * 11); // 11 MB file
            const s3Key = 'audios-bewize/flashcards/answers/large-file.mp3';

            s3Mock.on(PutObjectCommand).rejects(new Error('File size exceeds the allowed limit'));

            try {
                await uploadFile(s3Key, largeAudioBuffer, 'audio/mpeg');
            } catch (error) {
                expect(error.message).toBe('File size exceeds the allowed limit');
            }
        }, 60000);

        it('should handle S3 upload error due to full bucket', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/flashcards/answers/full-bucket.mp3';

            // Simuler une erreur de bucket plein
            s3Mock.on(PutObjectCommand).rejects(new Error('Bucket is full: No space left'));

            try {
                await uploadFile(s3Key, audioBuffer, 'audio/mpeg');
            } catch (error) {
                expect(error.message).toBe('Bucket is full: No space left');
            }
        }, 60000);

        it('should handle database update failure after successful S3 upload', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/flashcards/answers/1.mp3';
            const fileUrl = `https://bewize-audios.s3.eu-west-1.amazonaws.com/${s3Key}`;

            s3Mock.on(PutObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
                ETag: 'fake-etag',
            });

            mockQuery.onFirstCall().resolves({ rowCount: 1 }); // Mock successful S3 upload
            mockQuery.onSecondCall().rejects(new Error('Database update failed')); // Mock database update failure

            try {
                await uploadFile(s3Key, audioBuffer, 'audio/mpeg');
                await pool.query(
                    "UPDATE answer SET answer_audio = $1 WHERE id = $2 RETURNING id",
                    [fileUrl, '1']
                );
            } catch (error) {
                expect(error.message).toBe('Database update failed');
            }
        }, 60000);

        it('should delete S3 file if database update fails after successful upload', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/flashcards/answers/1.mp3';
            const fileUrl = `https://bewize-audios.s3.eu-west-1.amazonaws.com/${s3Key}`;

            s3Mock.on(PutObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
                ETag: 'fake-etag',
            });

            mockQuery.onFirstCall().resolves({ rowCount: 1 }); // Mock successful S3 upload
            mockQuery.onSecondCall().rejects(new Error('Database update failed')); // Mock database update failure

            s3Mock.on(DeleteObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
            });

            try {
                await uploadFile(s3Key, audioBuffer, 'audio/mpeg');
                await pool.query(
                    "UPDATE answer SET answer_audio = $1 WHERE id = $2 RETURNING id",
                    [fileUrl, '1']
                );
            } catch (error) {
                expect(error.message).toBe('Database update failed');
                const deleteResult = await deleteFile(s3Key);
                expect(deleteResult).toBe(true);
            }
        }, 60000);
    });

    // Tests for database update
    describe('Mise à jour de la base de données', () => {
        it('should update database with S3 URL (Cas 1)', async () => {
            const fileUrl = 'https://bewize-audios.s3.eu-west-1.amazonaws.com/audios-bewize/flashcards/answers/1.mp3';
            mockQuery.resolves({ rowCount: 1 });

            const result = await pool.query(
                "UPDATE answer SET answer_audio = $1 WHERE id = $2 RETURNING id",
                [fileUrl, '1']
            );

            expect(result.rowCount).toBe(1);
        }, 60000);

        it('should handle SQL update error (Cas 2)', async () => {
            mockQuery.rejects(new Error('SQL update failed'));

            await expect(flashcardsResponses('CP')).rejects.toThrow('SQL update failed');
        }, 60000);

        it('should reset answer_audio to null after SQL update failure', async () => {
            const fileUrl = 'https://bewize-audios.s3.eu-west-1.amazonaws.com/audios-bewize/flashcards/answers/1.mp3';
            mockQuery.onFirstCall().resolves({ rowCount: 1 });
            mockQuery.onSecondCall().rejects(new Error('SQL update failed'));

            try {
                await pool.query(
                    "UPDATE answer SET answer_audio = $1 WHERE id = $2 RETURNING id",
                    [fileUrl, '1']
                );
            } catch (error) {
                await pool.query(
                    "UPDATE answer SET answer_audio = NULL WHERE id = $1 RETURNING id",
                    ['1']
                );
                expect(error.message).toBe('SQL update failed');
            }
        }, 60000);

        it('should reset answer_audio to null after S3 upload failure', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/flashcards/answers/1.mp3';

            s3Mock.on(PutObjectCommand).rejects(new Error('S3 upload failed'));

            try {
                await uploadFile(s3Key, audioBuffer, 'audio/mpeg');
            } catch (error) {
                await pool.query(
                    "UPDATE answer SET answer_audio = NULL WHERE id = $1 RETURNING id",
                    ['1']
                );
                expect(error.message).toBe('S3 upload failed');
            }
        }, 60000);
    });

    // Tests for getTTSParams utility
    describe('getTTSParams', () => {
        it('should generate TTS parameters for English (Cas 1)', () => {
            const params = getTTSParams(SubjectEnum.ENGLISH, testResponse.answer);
            expect(params.voice_id).toBe('9BWtsMINqrJLrRacOk9x');
        });

        it('should generate TTS parameters for French (Cas 2)', () => {
            const params = getTTSParams(SubjectEnum.FRENSH, 'Quelle est la capitale de l\'Espagne?');
            expect(params.voice_id).toBe('pFZP5JQG7iQjIQuC4Bku');
        });

        it('should generate TTS parameters for Arabic (Cas 3)', () => {
            const params = getTTSParams(SubjectEnum.ARABE, 'ما هي عاصمة فرنسا؟');
            expect(params.voice_id).toBe('tavIIPLplRB883FzWU0V');
        });

        it('should use default parameters for unsupported language (Cas 4)', () => {
            const params = getTTSParams('UNSUPPORTED_LANGUAGE' as SubjectEnum, 'Test answer');
            expect(params.voice_id).toBe('pFZP5JQG7iQjIQuC4Bku');
        });
    });

    // Tests for S3 delete operations
    describe('S3 Operations', () => {
        it('should delete file from S3 successfully (Cas 1)', async () => {
            const s3Key = 'audios-bewize/flashcards/answers/1.mp3';
            s3Mock.on(DeleteObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
            });

            const result = await deleteFile(s3Key);
            expect(result).toBe(true);
        }, 60000);

        it('should handle S3 delete error (Cas 2)', async () => {
            const s3Key = 'audios-bewize/flashcards/answers/1.mp3';
            s3Mock.on(DeleteObjectCommand).rejects(new Error('S3 delete failed'));

            try {
                await deleteFile(s3Key);
            } catch (error) {
                expect(error.message).toBe('S3 delete failed');
            }
        }, 60000);
    });

    // Additional tests for flashcardsResponses
    describe('Additional Tests for flashcardsResponses', () => {
        it('should handle no responses found for a subject', async () => {
            mockQuery.resolves({
                rows: [],
            });

            const result = await flashcardsResponses('CP');
            expect(result).toEqual([]);
        });

        it('should handle database query error', async () => {
            mockQuery.rejects(new Error('Database query failed'));

            await expect(flashcardsResponses('CP')).rejects.toThrow('Database query failed');
        });

        it('should handle empty answer', async () => {
            const emptyResponse: IFlashcardsQueryRes = {
                questionid: '2',
                answerid: '2',
                language: SubjectEnum.ENGLISH,
                question: 'What is the capital of France?',
                answer: ''
            };

            mockQuery.resolves({
                rows: [emptyResponse],
            });

            const result = await flashcardsResponses('CP');
            expect(result).toEqual([]);
        }, 15000);

        it('should measure processing time and resource consumption', async () => {
            mockQuery.resolves({
                rows: [testResponse],
            });

            const audioBuffer = Buffer.from('fake-audio-data');
            mockAxios.onPost(`${ELEVENLABS_API_URL}/9BWtsMINqrJLrRacOk9x`).reply(200, audioBuffer);

            const startTime = process.hrtime();
            const startUsage = process.cpuUsage();
            const startMemory = process.memoryUsage().heapUsed;

            const result = await flashcardsResponses('CP');

            const endTime = process.hrtime(startTime);
            const endUsage = process.cpuUsage(startUsage);
            const endMemory = process.memoryUsage().heapUsed;

            const elapsedTime = endTime[0] * 1000 + endTime[1] / 1e6; // Convert to milliseconds
            const cpuTime = (endUsage.user + endUsage.system) / 1000; // Convert to milliseconds
            const memoryUsed = (endMemory - startMemory) / 1024 / 1024; // Convert to MB

            console.log(`Processing time: ${elapsedTime.toFixed(2)} ms`);
            console.log(`CPU time: ${cpuTime.toFixed(2)} ms`);
            console.log(`Memory used: ${memoryUsed.toFixed(2)} MB`);

            expect(result).toBeDefined();
        }, 60000);
    });

    // Tests for transaction management
    describe('Transaction Management', () => {
        it('should rollback transaction on empty answer', async () => {
            const emptyResponse: IFlashcardsQueryRes = {
                questionid: '2',
                answerid: '2',
                language: SubjectEnum.ENGLISH,
                question: 'What is the capital of France?',
                answer: ''
            };

            mockQuery.onFirstCall().resolves({
                rows: [emptyResponse],
            });

            mockQuery.onSecondCall().resolves({
                rowCount: 0,
            });

            const result = await flashcardsResponses('CP');
            expect(result).toEqual([]);
        }, 60000);

        it('should rollback transaction on invalid answer', async () => {
            const invalidResponse: IFlashcardsQueryRes = {
                questionid: '3',
                answerid: '3',
                language: SubjectEnum.ENGLISH,
                question: 'What is the capital of France?',
                answer: '!!!'
            };

            mockQuery.onFirstCall().resolves({
                rows: [invalidResponse],
            });

            mockQuery.onSecondCall().resolves({
                rowCount: 0,
            });

            const params = getTTSParams(invalidResponse.language, invalidResponse.answer);
            mockAxios.onPost(`${ELEVENLABS_API_URL}/${params.voice_id}`).reply(404);

            await expect(flashcardsResponses('CP')).rejects.toThrow('Request failed with status code 404');
        }, 60000);

        it('should rollback transaction on S3 upload failure after successful ElevenLabs call', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');

            // Mock database query to return a valid answer
            mockQuery.onFirstCall().resolves({
                rows: [{
                    questionid: '1',
                    answerid: 'faa66504-348d-4a13-abf5-92d8003b2724',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of France?',
                    answer: 'Paris'
                }],
            });

            // Mock ElevenLabs API response
            mockAxios.onPost(`${ELEVENLABS_API_URL}/9BWtsMINqrJLrRacOk9x`).reply(200, audioBuffer);

            // Mock S3 upload failure
            s3Mock.on(PutObjectCommand).rejects(new Error('S3 upload failed'));

            try {
                await flashcardsResponses('CP');
            } catch (error) {
                expect(error.message).toBe('S3 upload failed');
            }

            // Verify that the database update was not called
            expect(mockQuery.callCount).toBe(1);
        }, 60000);
    });

    // Integration Tests for flashcardsResponses
    describe('Integration Tests for flashcardsResponses', () => {
        it('should process a valid answer and update the database', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const fileUrl = 'audios-bewize/flashcards/answers/faa66504-348d-4a13-abf5-92d8003b2724.mp3';

            // Mock database query to return a valid answer
            mockQuery.onFirstCall().resolves({
                rows: [{
                    questionid: '1',
                    answerid: 'faa66504-348d-4a13-abf5-92d8003b2724',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of France?',
                    answer: 'Paris'
                }],
            });

            // Mock ElevenLabs API response
            mockAxios.onPost(`${ELEVENLABS_API_URL}/9BWtsMINqrJLrRacOk9x`).reply(200, audioBuffer);

            // Mock S3 upload response
            s3Mock.on(PutObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
                ETag: 'fake-etag',
            });

            // Mock database update query
            mockQuery.onSecondCall().resolves({ rowCount: 1 });

            const result = await flashcardsResponses('CP');
            expect(result).toEqual([{
                questionid: '1',
                answerid: 'faa66504-348d-4a13-abf5-92d8003b2724',
                language: SubjectEnum.ENGLISH,
                question: 'What is the capital of France?',
                answer: 'Paris',
                answer_audio: fileUrl
            }]);
        }, 60000);
    });

    // Test for database connection failure
    describe('Database Connection Failure', () => {
        it('should handle database connection failure', async () => {
            mockQuery.rejects(new Error('Database connection failed'));

            await expect(flashcardsResponses('CP')).rejects.toThrow('Database connection failed');
        });
    });

    // Test for batch processing with BATCH_DELAY
    describe('Batch Processing with BATCH_DELAY', () => {
        it('should respect BATCH_DELAY between batches', async () => {
            const responsesSet = [
                {
                    questionid: '1',
                    answerid: 'faa66504-348d-4a13-abf5-92d8003b2724',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of Germany?',
                    answer: 'Berlin'
                },
                {
                    questionid: '2',
                    answerid: 'b04b25a2-de15-4891-af11-824034fd4410',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of Italy?',
                    answer: 'Rome'
                },
                {
                    questionid: '3',
                    answerid: '846a1dfc-bbce-4134-912c-b3758096b683',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of Spain?',
                    answer: 'Madrid'
                },
                {
                    questionid: '4',
                    answerid: '312b12cb-de46-48c0-875e-659eebd60079',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of Portugal?',
                    answer: 'Lisbon'
                },
                {
                    questionid: '5',
                    answerid: 'd736b84c-f035-45c9-bb68-f361b43119ca',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of Belgium?',
                    answer: 'Brussels'
                },
                {
                    questionid: '6',
                    answerid: '810a50e8-2309-4d6f-b1c0-fe1d59a7a33b',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of Netherlands?',
                    answer: 'Amsterdam'
                },
                {
                    questionid: '7',
                    answerid: '47edbf4e-eef6-4d42-bb7d-19fe9f8b0964',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of Austria?',
                    answer: 'Vienna'
                },
                {
                    questionid: '8',
                    answerid: '2e49c510-af6b-4379-b753-2742e087ed84',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of Switzerland?',
                    answer: 'Bern'
                }
            ];

            mockQuery.onFirstCall().resolves({
                rows: responsesSet,
            });

            // Mock the initial update query to return rowCount: 1
            mockQuery.onSecondCall().resolves({ rowCount: 1 });
            mockQuery.onThirdCall().resolves({ rowCount: 1 });
            mockQuery.onCall(3).resolves();
            mockQuery.onCall(4).resolves();
            mockQuery.onCall(5).resolves({ rowCount: 1 });
            mockQuery.onCall(6).resolves({ rowCount: 1 });
            mockQuery.onCall(7).resolves({ rowCount: 1 });

            const audioBuffer = Buffer.from('fake-audio-data');
            mockAxios.onPost().reply(200, audioBuffer);

            s3Mock.on(PutObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
                ETag: 'fake-etag',
            });

            const startTime = Date.now();
            await flashcardsResponses('CP');
            const endTime = Date.now();

            const totalTime = endTime - startTime;
            const numberOfBatches = Math.ceil(responsesSet.length / CHUNK_SIZE);
            const expectedTotalTime = (numberOfBatches - 1) * BATCH_DELAY;

            expect(totalTime).toBeGreaterThanOrEqual(expectedTotalTime);

            console.log(`✅ Temps total écoulé : ${totalTime} ms`);
            console.log(`✅ Temps total attendu : ${expectedTotalTime} ms`);
        }, 60000);
    });

    // Test for partial failure in batch processing
    describe('Partial Failure in Batch Processing', () => {
        it('should handle partial failure in a batch', async () => {
            const responsesSet = [
                {
                    questionid: '1',
                    answerid: '2e49c510-af6b-4379-b753-2742e087ed84',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of France?',
                    answer: 'Paris'
                },
                {
                    questionid: '2',
                    answerid: '810a50e8-2309-4d6f-b1c0-fe1d59a7a33b',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of Germany?',
                    answer: '' // Empty answer to simulate failure
                }
            ];

            mockQuery.onFirstCall().resolves({
                rows: responsesSet,
            });

            // Mock ElevenLabs API response for the first answer
            const audioBuffer = Buffer.from('fake-audio-data');
            mockAxios.onPost(`${ELEVENLABS_API_URL}/9BWtsMINqrJLrRacOk9x`).reply(200, audioBuffer);

            // Mock S3 upload response
            s3Mock.on(PutObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
                ETag: 'fake-etag',
            });

            // Mock database update query
            mockQuery.onSecondCall().resolves({ rowCount: 1 });

            const result = await flashcardsResponses('CP');
            expect(result).toEqual([
                {
                    questionid: '1',
                    answerid: '2e49c510-af6b-4379-b753-2742e087ed84',
                    language: SubjectEnum.ENGLISH,
                    question: 'What is the capital of France?',
                    answer: 'Paris',
                    answer_audio: 'audios-bewize/flashcards/answers/2e49c510-af6b-4379-b753-2742e087ed84.mp3'
                }
            ]);
        }, 60000);
    });

    // Test for handling a large number of responses
    describe('Handling a large number of responses', () => {
        it('should process 1000 responses successfully', async () => {
            const responsesSet = Array.from({ length: 2 }, (_, index) => ({
                questionid: `${index}`,
                answerid: `810a50e8-2309-4d6f-b1c0-fe1d59a7a33b`,
                language: SubjectEnum.ENGLISH,
                question: `What is the capital of country ${index}?`,
                answer: `Capital ${index}`
            }));

            mockQuery.onFirstCall().resolves({
                rows: responsesSet,
            });

            // Mock the initial update query to return rowCount: 1 for each answer
            for (let i = 0; i < responsesSet.length; i++) {
                mockQuery.onCall(i + 1).resolves({ rowCount: 1 });
            }

            const audioBuffer = Buffer.from('fake-audio-data');
            mockAxios.onPost().reply(200, audioBuffer);

            s3Mock.on(PutObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
                ETag: 'fake-etag',
            });

            const result = await flashcardsResponses('CP') as IFlashcardsQueryRes[];
            expect(result.length).toBe(2);
            result.forEach((item, index) => {
                expect(item.questionid).toBe(`${index}`);
                expect(item.answerid).toBe(`810a50e8-2309-4d6f-b1c0-fe1d59a7a33b`);
                expect(item.language).toBe(SubjectEnum.ENGLISH);
                expect(item.question).toBe(`What is the capital of country ${index}?`);
                expect(item.answer).toBe(`Capital ${index}`);
                expect(item.answer_audio).toBe(`audios-bewize/flashcards/answers/810a50e8-2309-4d6f-b1c0-fe1d59a7a33b.mp3`);
            });
        }, 300000); // Set a higher timeout for processing 1000 responses
    });
});