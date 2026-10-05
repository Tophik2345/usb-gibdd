import { splitExplanation } from '@/lib/question-reference';
import CurrentNorm from './current-norm';
export default function QuestionExplanation({text}:{text:string}){
 const parts=splitExplanation(text);
 return <div className="explanation">{parts.text&&<p>{parts.text}</p>}{parts.reference&&<><a href={parts.reference.href} target="_blank" rel="noopener noreferrer" className="text-button">Открыть статью в «Законы РО» ↗</a><CurrentNorm href={parts.reference.href}/></>}</div>;
}
