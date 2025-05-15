import { SubjectEnum } from "../enums/SubjectEnum";

export interface IQuizzesQueryRes {
  questionid: string;
  language: SubjectEnum;
  feedback: string;
  feedback_audio?: string;
}
