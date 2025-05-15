import { quizzesFeedback } from "../src/scripts/quizzesFeeback";
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
import { IQuizzesQueryRes } from "../src/interfaces/IQuizzesQueryRes";
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

describe('quizzesFeedback', () => {
    let testFeedback: IQuizzesQueryRes;
    let mockQuery: sinon.SinonStub;

    beforeAll(() => {
        jest.setTimeout(120000);
        console.log('🚀 Starting tests...');

        testFeedback = {
            questionid: 'c7c04ac8-d86e-4041-927b-191dc5850a2e',
            language: SubjectEnum.ENGLISH,
            feedback: 'Good job! The capital of France is Paris.'
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
            const params = getTTSParams(SubjectEnum.ENGLISH, testFeedback.feedback);
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
                rows: [testFeedback],
            });

            await expect(quizzesFeedback('CP')).rejects.toMatchObject({
                response: { status: 401 },
            });
        }, 60000);

        it('should throw an error when receiving a 429 status code', async () => {
            mockAxios.onPost().reply(429);

            mockQuery.resolves({
                rows: [testFeedback],
            });

            await expect(quizzesFeedback('CP')).rejects.toMatchObject({
                response: { status: 429 },
            });
        }, 60000);

        it('should handle 500 error from ElevenLabs API (Cas 4)', async () => {
            mockAxios.onPost().reply(500);

            mockQuery.resolves({
                rows: [testFeedback],
            });

            await expect(quizzesFeedback('CP')).rejects.toMatchObject({
                response: { status: 500 },
            });
        }, 60000);
    });

    // Tests for S3 upload
    describe('Upload sur S3', () => {
        it('should upload audio file to S3 successfully (Cas 1)', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/quizzes/feedbacks/1.mp3';
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
            const s3Key = 'audios-bewize/quizzes/feedbacks/1.mp3';
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
            const s3Key = 'audios-bewize/quizzes/feedbacks/large-file.mp3';

            s3Mock.on(PutObjectCommand).rejects(new Error('File size exceeds the allowed limit'));

            try {
                await uploadFile(s3Key, largeAudioBuffer, 'audio/mpeg');
            } catch (error) {
                expect(error.message).toBe('File size exceeds the allowed limit');
            }
        }, 60000);

        it('should handle S3 upload error due to full bucket', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/quizzes/feedbacks/full-bucket.mp3';

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
            const s3Key = 'audios-bewize/quizzes/feedbacks/1.mp3';
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
                    "UPDATE question SET feedback_audio = $1 WHERE id = $2 RETURNING id",
                    [fileUrl, '1']
                );
            } catch (error) {
                expect(error.message).toBe('Database update failed');
            }
        }, 60000);

        it('should delete S3 file if database update fails after successful upload', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/quizzes/feedbacks/1.mp3';
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
                    "UPDATE question SET feedback_audio = $1 WHERE id = $2 RETURNING id",
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
            const fileUrl = 'https://bewize-audios.s3.eu-west-1.amazonaws.com/audios-bewize/quizzes/feedbacks/1.mp3';
            mockQuery.resolves({ rowCount: 1 });

            const result = await pool.query(
                "UPDATE question SET feedback_audio = $1 WHERE id = $2 RETURNING id",
                [fileUrl, '1']
            );

            expect(result.rowCount).toBe(1);
        }, 60000);

        it('should handle SQL update error (Cas 2)', async () => {
            mockQuery.rejects(new Error('SQL update failed'));

            await expect(quizzesFeedback('CP')).rejects.toThrow('SQL update failed');
        }, 60000);

        it('should reset feedback_audio to null after SQL update failure', async () => {
            const fileUrl = 'https://bewize-audios.s3.eu-west-1.amazonaws.com/audios-bewize/quizzes/feedbacks/1.mp3';
            mockQuery.onFirstCall().resolves({ rowCount: 1 });
            mockQuery.onSecondCall().rejects(new Error('SQL update failed'));

            try {
                await pool.query(
                    "UPDATE question SET feedback_audio = $1 WHERE id = $2 RETURNING id",
                    [fileUrl, '1']
                );
            } catch (error) {
                await pool.query(
                    "UPDATE question SET feedback_audio = NULL WHERE id = $1 RETURNING id",
                    ['1']
                );
                expect(error.message).toBe('SQL update failed');
            }
        }, 60000);

        it('should reset feedback_audio to null after S3 upload failure', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const s3Key = 'audios-bewize/quizzes/feedbacks/1.mp3';

            s3Mock.on(PutObjectCommand).rejects(new Error('S3 upload failed'));

            try {
                await uploadFile(s3Key, audioBuffer, 'audio/mpeg');
            } catch (error) {
                await pool.query(
                    "UPDATE question SET feedback_audio = NULL WHERE id = $1 RETURNING id",
                    ['1']
                );
                expect(error.message).toBe('S3 upload failed');
            }
        }, 60000);
    });

    // Tests for getTTSParams utility
    describe('getTTSParams', () => {
        it('should generate TTS parameters for English (Cas 1)', () => {
            const params = getTTSParams(SubjectEnum.ENGLISH, testFeedback.feedback);
            expect(params.voice_id).toBe('9BWtsMINqrJLrRacOk9x');
        });

        it('should generate TTS parameters for French (Cas 2)', () => {
            const params = getTTSParams(SubjectEnum.FRENSH, 'Bon travail!');
            expect(params.voice_id).toBe('pFZP5JQG7iQjIQuC4Bku');
        });

        it('should generate TTS parameters for Arabic (Cas 3)', () => {
            const params = getTTSParams(SubjectEnum.ARABE, 'عمل جيد!');
            expect(params.voice_id).toBe('tavIIPLplRB883FzWU0V');
        });

        it('should use default parameters for unsupported language (Cas 4)', () => {
            const params = getTTSParams('UNSUPPORTED_LANGUAGE' as SubjectEnum, 'Test feedback');
            expect(params.voice_id).toBe('pFZP5JQG7iQjIQuC4Bku');
        });
    });

    // Tests for S3 delete operations
    describe('S3 Operations', () => {
        it('should delete file from S3 successfully (Cas 1)', async () => {
            const s3Key = 'audios-bewize/quizzes/feedbacks/1.mp3';
            s3Mock.on(DeleteObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
            });

            const result = await deleteFile(s3Key);
            expect(result).toBe(true);
        }, 60000);

        it('should handle S3 delete error (Cas 2)', async () => {
            const s3Key = 'audios-bewize/quizzes/feedbacks/1.mp3';
            s3Mock.on(DeleteObjectCommand).rejects(new Error('S3 delete failed'));

            try {
                await deleteFile(s3Key);
            } catch (error) {
                expect(error.message).toBe('S3 delete failed');
            }
        }, 60000);
    });

    // Additional tests for quizzesFeedback
    describe('Additional Tests for quizzesFeedback', () => {
        it('should handle no feedbacks found for a subject', async () => {
            mockQuery.resolves({
                rows: [],
            });

            const result = await quizzesFeedback('CP');
            expect(result).toEqual([]);
        });

        it('should handle database query error', async () => {
            mockQuery.rejects(new Error('Database query failed'));

            await expect(quizzesFeedback('CP')).rejects.toThrow('Database query failed');
        });

        it('should handle empty feedback', async () => {
            const emptyFeedback: IQuizzesQueryRes = {
                questionid: '2',
                language: SubjectEnum.ENGLISH,
                feedback: '',
            };

            mockQuery.resolves({
                rows: [emptyFeedback],
            });

            const result = await quizzesFeedback('CP');
            expect(result).toEqual([]);
        }, 15000);

        it('should measure processing time and resource consumption', async () => {
            mockQuery.resolves({
                rows: [testFeedback],
            });

            const audioBuffer = Buffer.from('fake-audio-data');
            mockAxios.onPost(`${ELEVENLABS_API_URL}/9BWtsMINqrJLrRacOk9x`).reply(200, audioBuffer);

            const startTime = process.hrtime();
            const startUsage = process.cpuUsage();
            const startMemory = process.memoryUsage().heapUsed;

            const result = await quizzesFeedback('CP');

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
        it('should rollback transaction on empty feedback', async () => {
            const emptyFeedback: IQuizzesQueryRes = {
                questionid: '2',
                language: SubjectEnum.ENGLISH,
                feedback: '',
            };

            mockQuery.onFirstCall().resolves({
                rows: [emptyFeedback],
            });

            mockQuery.onSecondCall().resolves({
                rowCount: 0,
            });

            const result = await quizzesFeedback('CP');
            expect(result).toEqual([]);
        }, 60000);

        it('should rollback transaction on invalid feedback', async () => {
            const invalidFeedback: IQuizzesQueryRes = {
                questionid: '3',
                language: SubjectEnum.ENGLISH,
                feedback: '!!!',
            };

            mockQuery.onFirstCall().resolves({
                rows: [invalidFeedback],
            });

            mockQuery.onSecondCall().resolves({
                rowCount: 0,
            });

            const params = getTTSParams(invalidFeedback.language, invalidFeedback.feedback);
            mockAxios.onPost(`${ELEVENLABS_API_URL}/${params.voice_id}`).reply(404);

            await expect(quizzesFeedback('CP')).rejects.toThrow('Request failed with status code 404');
        }, 60000);

        it('should rollback transaction on S3 upload failure after successful ElevenLabs call', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');

            // Mock database query to return a valid feedback
            mockQuery.onFirstCall().resolves({
                rows: [{
                    questionid: 'c7c04ac8-d86e-4041-927b-191dc5850a2e',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Good job! The capital of France is Paris.'
                }],
            });

            // Mock ElevenLabs API response
            mockAxios.onPost(`${ELEVENLABS_API_URL}/9BWtsMINqrJLrRacOk9x`).reply(200, audioBuffer);

            // Mock S3 upload failure
            s3Mock.on(PutObjectCommand).rejects(new Error('S3 upload failed'));

            try {
                await quizzesFeedback('CP');
            } catch (error) {
                expect(error.message).toBe('S3 upload failed');
            }

            // Verify that the database update was not called
            expect(mockQuery.callCount).toBe(1);
        }, 60000);
    });

    // Integration Tests for quizzesFeedback
    describe('Integration Tests for quizzesFeedback', () => {
        it('should process a valid feedback and update the database', async () => {
            const audioBuffer = Buffer.from('fake-audio-data');
            const fileUrl = 'audios-bewize/quizzes/feedbacks/c7c04ac8-d86e-4041-927b-191dc5850a2e.mp3';

            // Mock database query to return a valid feedback
            mockQuery.onFirstCall().resolves({
                rows: [{
                    questionid: 'c7c04ac8-d86e-4041-927b-191dc5850a2e',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Good job! The capital of France is Paris.'
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

            const result = await quizzesFeedback('CP');
            expect(result).toEqual([{
                questionid: 'c7c04ac8-d86e-4041-927b-191dc5850a2e',
                language: SubjectEnum.ENGLISH,
                feedback: 'Good job! The capital of France is Paris.',
                feedback_audio: fileUrl
            }]);
        }, 60000);
    });

    // Test for database connection failure
    describe('Database Connection Failure', () => {
        it('should handle database connection failure', async () => {
            mockQuery.rejects(new Error('Database connection failed'));

            await expect(quizzesFeedback('CP')).rejects.toThrow('Database connection failed');
        });
    });

    // Test for batch processing with BATCH_DELAY
    describe('Batch Processing with BATCH_DELAY', () => {
        it('should respect BATCH_DELAY between batches', async () => {
            const feedbacksSet = [
                {
                    questionid: '04aebca4-c645-494c-b4b2-4fc18b20ee4f',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Good job! The capital of Germany is Berlin.'
                },
                {
                    questionid: 'efb649f4-61c4-45cd-9bc2-e48082bebc16',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Well done! The capital of Italy is Rome.'
                },
                {
                    questionid: '960d1250-ada5-4d51-8db5-5fa2ab381ad8',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Excellent! The capital of Spain is Madrid.'
                },
                {
                    questionid: 'af459130-bd13-478e-adae-2e720f4bea97',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Great work! The capital of Portugal is Lisbon.'
                },
                {
                    questionid: '87d8b82f-1a8a-4b1c-95f6-5d1c7429936f',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Keep it up! The capital of Belgium is Brussels.'
                },
                {
                    questionid: 'e512002c-360a-466c-b239-f049b55433ab',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Fantastic! The capital of Netherlands is Amsterdam.'
                },
                {
                    questionid: 'b0c25c4a-e43b-466d-8b36-136bb397f312',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Amazing! The capital of Austria is Vienna.'
                },
                {
                    questionid: '8b73da42-8974-4d17-92ad-2a799b4630de',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Outstanding! The capital of Switzerland is Bern.'
                }
            ];

            mockQuery.onFirstCall().resolves({
                rows: feedbacksSet,
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
            await quizzesFeedback('CP');
            const endTime = Date.now();

            const totalTime = endTime - startTime;
            const numberOfBatches = Math.ceil(feedbacksSet.length / CHUNK_SIZE);
            const expectedTotalTime = (numberOfBatches - 1) * BATCH_DELAY;

            expect(totalTime).toBeGreaterThanOrEqual(expectedTotalTime);

            console.log(`✅ Temps total écoulé : ${totalTime} ms`);
            console.log(`✅ Temps total attendu : ${expectedTotalTime} ms`);
        }, 60000);
    });

    // Test for partial failure in batch processing
    describe('Partial Failure in Batch Processing', () => {
        it('should handle partial failure in a batch', async () => {
            const feedbacksSet = [
                {
                    questionid: '04aebca4-c645-494c-b4b2-4fc18b20ee4f',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Good job! The capital of France is Paris.'
                },
                {
                    questionid: 'efb649f4-61c4-45cd-9bc2-e48082bebc16',
                    language: SubjectEnum.ENGLISH,
                    feedback: '', // Empty feedback to simulate failure
                }
            ];

            mockQuery.onFirstCall().resolves({
                rows: feedbacksSet,
            });

            // Mock ElevenLabs API response for the first feedback
            const audioBuffer = Buffer.from('fake-audio-data');
            mockAxios.onPost(`${ELEVENLABS_API_URL}/9BWtsMINqrJLrRacOk9x`).reply(200, audioBuffer);

            // Mock S3 upload response
            s3Mock.on(PutObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
                ETag: 'fake-etag',
            });

            // Mock database update query
            mockQuery.onSecondCall().resolves({ rowCount: 1 });

            const result = await quizzesFeedback('CP');
            expect(result).toEqual([
                {
                    questionid: '04aebca4-c645-494c-b4b2-4fc18b20ee4f',
                    language: SubjectEnum.ENGLISH,
                    feedback: 'Good job! The capital of France is Paris.',
                    feedback_audio: 'audios-bewize/quizzes/feedbacks/04aebca4-c645-494c-b4b2-4fc18b20ee4f.mp3'
                }
            ]);
        }, 60000);
    });

    // Test for handling a large number of feedbacks
    describe('Handling a large number of feedbacks', () => {
        it('should process 1000 feedbacks successfully', async () => {
            const feedbacksSet = Array.from({ length: 2 }, (_, index) => ({
                questionid: `04aebca4-c645-494c-b4b2-4fc18b20ee4f`,
                language: SubjectEnum.ENGLISH,
                feedback: `Good job on question ${index}!`
            }));

            mockQuery.onFirstCall().resolves({
                rows: feedbacksSet,
            });

            // Mock the initial update query to return rowCount: 1 for each feedback
            for (let i = 0; i < feedbacksSet.length; i++) {
                mockQuery.onCall(i + 1).resolves({ rowCount: 1 });
            }

            const audioBuffer = Buffer.from('fake-audio-data');
            mockAxios.onPost().reply(200, audioBuffer);

            s3Mock.on(PutObjectCommand).resolves({
                $metadata: { httpStatusCode: 200 },
                ETag: 'fake-etag',
            });

            const result = await quizzesFeedback('CP') as IQuizzesQueryRes[];
            expect(result.length).toBe(2);
            result.forEach((item, index) => {
                expect(item.questionid).toBe(`04aebca4-c645-494c-b4b2-4fc18b20ee4f`);
                expect(item.language).toBe(SubjectEnum.ENGLISH);
                expect(item.feedback).toBe(`Good job on question ${index}!`);
                expect(item.feedback_audio).toBe(`audios-bewize/quizzes/feedbacks/04aebca4-c645-494c-b4b2-4fc18b20ee4f.mp3`);
            });
        }, 300000); // Set a higher timeout for processing 1000 feedbacks
    });
});