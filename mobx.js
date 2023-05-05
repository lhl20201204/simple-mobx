const initGlobalState = {
  trackingReaction: null,
  isTrackingReactionInAction: false,
  penddingReaction: new Set(),
  isInAction: false,
  isInComputedAction: false,
  isInComputedMethod: false,
  inBatch: 0,
  reactionId: 0,
  computedId: 0,
  boxId: 0,
}
let globalState = {
  ...initGlobalState,
  logger: false,
}
const $MOBX = Symbol('mobx administration')
const $ACTION = Symbol('mobx action')
const $COMPUTED_ACTION = Symbol('mobx computed action')

function _resetGlobalState() {
  for (const attr in initGlobalState) {
    globalState[attr] = initGlobalState[attr]
  }
}

function startBatch(){
  globalState.inBatch ++
}

function endBatch() {
  --globalState.inBatch
 if (globalState.inBatch === 0) {
  const reactionList = globalState.penddingReaction
  reactionList.forEach(reaction => {
    reaction.observableAtom.forEach(atom => {
      atom.observing.delete(reaction)
    })
  })
  reactionList.forEach(reaction => {
    reaction.track()
  })
  globalState.penddingReaction.clear()
 }
}


class Atom{
  constructor(name, value) {
    this.name = name;
    this.value = typeof value === 'object' ? observable(value) : value;
    this.observing = new Set();
  }

  setNewValue(v) {
    if (globalState.isInComputedMethod && !globalState.isInAction) {
      throw new Error("computed 函数内只能在action方法里设置属性值")
    }
    const oldValue = this.value;
    this.value = v;
    if ((oldValue !== this.value) && this.observing.size > 0) {
      startBatch()
      this.observing.forEach(reaction => {
        globalState.penddingReaction.add(reaction)
        reaction.observableAtom.add(this);
      })
      endBatch()
    }
  }

  set(v) {
    this.setNewValue(v)
  }

  get(){
    if (globalState.trackingReaction 
      && ((!globalState.isInAction 
      && !globalState.isInComputedAction) || globalState.isTrackingReactionInAction)) {
      this.observing.add(globalState.trackingReaction)
    }
    return this.value
  }
}

class Reaction{
  constructor(view) {
    this.id = globalState.reactionId++;
    this.isDisposed = false;
    this.view = view;
    this.observableAtom = new Set();
    this.track()
  }

  schedule(){
    this.view();
  }

  dispose = () => {
    this.isDisposed = true;
  }

  track() {
    if (this.isDisposed){
      return;
    }
    const preReaction = globalState.trackingReaction
    globalState.trackingReaction = this;
    if (globalState.isInAction) {
      globalState.isTrackingReactionInAction = true;
    }
    this.schedule()
    globalState.isTrackingReactionInAction = false;
    globalState.trackingReaction = preReaction;
  }
}

function getProxy(obj) {
  const ret = new Map();
  for(const x in obj) {
    ret.set(x, new Atom(x, obj[x]))
  }
  return ret;
}


function observable(obj) {
  const copyObj = {...obj};
  const proxyObj =  {
    values: getProxy(obj),
    originObj: obj,
    copyObj,
    getProxyObj: () => proxyObj,
  };

  Reflect.defineProperty(obj, $MOBX, {
    enumerable: false,
    writable: false,
    value: proxyObj
  })

  // console.log(obj[$MOBX].originObj === obj);
  const proxyInstance =  new Proxy(obj[$MOBX].originObj, {
    set(target, p, newValue) {
      const observableValue =  target[$MOBX].values.get(p)
      if (observableValue instanceof Atom) {
        observableValue.setNewValue(newValue);
      }
      Reflect.set(target, p, newValue);
      Reflect.set(copyObj, p, newValue);
      globalState.logger && console.log('atom-set', p, newValue);
      return true;
    },
    get(target, p) {
      const v = target[$MOBX].values.get(p)
      let value = Reflect.get(copyObj, p);
      if (v instanceof Atom) {
        value = v.get()
      }

      if (_.isFunction(value)) {
        const ret = value.bind(proxyInstance);
        [$ACTION, $COMPUTED_ACTION].forEach(attr => {
          if (value[attr]) {
            Reflect.defineProperty(ret, attr, {
              value: value[attr],
              writable: false,
              enumerable: false,
            })
          }
        })
        return ret
      }
      globalState.logger && console.log('atom-get', p, value)
      return [$MOBX].includes(p) ? proxyObj : value
    },
    has(target, p) {
     const tempAtom = target[$MOBX].values.get(p)
      if (tempAtom instanceof Atom) {
        tempAtom.get()
      }
      return true
    }
  })

  return proxyInstance;
}

Reflect.defineProperty(observable, 'box', {
  value: (v) => new Atom('boxId@'+ globalState.boxId++, v),
  enumerable: false,
  writable: false,
})

function autorun(view) {
  const reaction = new Reaction(view)
  return reaction.dispose;
}

function action(name, view){
  const cb = view ?? name
  function fn (...args) {
    let ret
    let error = null
    try{
      if (!globalState.trackingReaction) {
        startBatch()
      }
      globalState.isInAction = true
      ret = cb.call(this, ...args)
    }catch(e) {
      error = e
    } finally{
      globalState.isInAction = false
      if (!globalState.trackingReaction) {
        endBatch()
      }
      if (error) {
        throw error
      }
      return ret
    }
    
  }

  Reflect.defineProperty(fn, $ACTION, {
    value: true,
    writable: false,
    enumerable: false,
  })
  return fn
}

function computedAction(name, view){
  const cb = view || name
  function fn (...args) {
    startBatch()
    globalState.isInComputedAction = true
    const ret = cb(...args)
    globalState.isInComputedAction = false
    endBatch()
    return ret
  }

  Reflect.defineProperty(fn, $COMPUTED_ACTION, {
    value: true,
    writable: false,
    enumerable: false,
  })
  return fn
}

function computed(view){
  const cb = () => {
    globalState.isInComputedMethod = true;
    const value = view()
    globalState.isInComputedMethod = false;
    return value
  }
  const atom = new Atom('computed@'+ globalState.computedId++, cb())
  const cAction = computedAction((value) => {
    atom.setNewValue(value)
  })
  let lastValue  = null
  autorun(() => {
    const value = cb()
    if (!_.isEqual(lastValue, value)) {
      lastValue = value
      cAction(value)
    }
  })
  return atom;
}

function observe(obj, cb) {
  if (!(obj instanceof Atom)) {
    throw new Error('非计算属性')
  }
  autorun(() => {
    if (obj.get()) {
      cb()
    }
  })
}

function isAction(fn) {
  return fn[$ACTION] ?? fn[$COMPUTED_ACTION] ?? false
}

  // mobx.extendObservable(a, {
  //     c: mobx.action(function () {
  //         this.a *= 3
  //     })
  // })
function extendObservable(originObj, extObj) {
  let originProxyInstance = originObj;
  if (!Reflect.has(originObj, $MOBX)) {
    originProxyInstance =  observable({})
    for(const attr in originObj) {
      originProxyInstance[attr] = originObj[attr]
    }
  }
  const proxyObj = Reflect.get(originProxyInstance, $MOBX);
  for(const attr in extObj) {
    const atom = new Atom(attr, extObj[attr])
    proxyObj.values.set(attr, atom)
    originProxyInstance[attr] = extObj[attr];
    Reflect.defineProperty(originObj, attr, {
      set(v) {
        if (!_.isEqual(v, originProxyInstance[attr])) {
        globalState.logger && console.log('define-set', attr, v)
          originProxyInstance[attr] = v;
        }
        return true
      },
      get() {
        globalState.logger && console.log('define-get', attr)
        return originProxyInstance[attr];
      }
    })
  }
}


const mobx = {
  observable,
  autorun,
  action,
  computed,
  observe,
  isAction,
  _resetGlobalState,
  extendObservable,
  globalState,
}