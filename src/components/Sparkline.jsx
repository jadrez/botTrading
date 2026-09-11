export default function Sparkline({data, color, width=80, height=22}){
  if(!data||data.length<2) return <svg width={width} height={height}/>;
  const min=Math.min(...data), max=Math.max(...data), range=(max-min)||1;
  const pts=data.map((v,i)=>{
    const x=(i/(data.length-1))*width;
    const y=height-2-((v-min)/range)*(height-4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return(
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4"/>
    </svg>
  );
}
