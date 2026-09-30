export default function QuestionExplanation({text}:{text:string}){
 const match=text.match(/\nОткрыть статью: (#laws\?document=(?:charter|criminal|labour|procedure|police|traffic-police|administrative|traffic-rules)&article=article-\d+)$/);
 return <div className="explanation"><p>{match?text.slice(0,match.index):text}</p>{match&&<a href={match[1]} target="_blank" rel="noopener noreferrer" className="text-button">Открыть статью в «Законы РО» ↗</a>}</div>;
}
