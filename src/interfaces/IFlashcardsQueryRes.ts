import { SubjectEnum } from "../enums/SubjectEnum";

export interface IFlashcardsQueryRes {
  questionid: string;
  answerid: string;
  language: SubjectEnum;
  question: string;
  answer: string;
  question_audio?: string; 
  answer_audio?: string;
  questiontype?:
    | "MULTIPLE_QCU"
    | "ONE_CHOICE"
    | "MULTI_CHOICE"
    | "DRAG_DROP_PUZZLE"
    | "MATCH"
    | "SORT"
    | "TEXT"
    | "FILL_BLANK_TEXT";
}