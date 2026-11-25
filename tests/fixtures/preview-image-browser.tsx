export default function Image({alt,className}: {alt:string;className?:string}) { return <span role="img" aria-label={alt} className={className}>Preview</span>; }
