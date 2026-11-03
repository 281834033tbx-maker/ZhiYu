'use client';

import {Component,type ErrorInfo,type ReactNode} from 'react';
import './user-facing-ui.css';

export function UserFacingErrorFallback({onReset}:{onReset:()=>void}) {
  return <section className="zy-user-facing-error" role="alert"><p>这里出了点问题</p><button type="button" onClick={onReset}>重新加载</button></section>;
}

type Props={children:ReactNode;resetKey?:string;onReset?:()=>void};
type State={failed:boolean;resetKey?:string};
export default class PageErrorBoundary extends Component<Props,State> {
  constructor(props:Props){super(props);this.state={failed:false,resetKey:props.resetKey};}
  static getDerivedStateFromError(){return {failed:true};}
  static getDerivedStateFromProps(props:Props,state:State){return props.resetKey!==state.resetKey?{failed:false,resetKey:props.resetKey}:null;}
  componentDidCatch(error:Error,info:ErrorInfo){console.error('[智域] 页面显示失败',error,info.componentStack);}
  reset=()=>{this.props.onReset?.();this.setState({failed:false});};
  render(){return this.state.failed?<UserFacingErrorFallback onReset={this.reset}/>:this.props.children;}
}
