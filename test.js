const list = []
// 收集测试单元
function test(name, cb) {
  list.push([name, cb])
}


test("action should wrap in transaction", () => {
  const values = []

  const observable = mobx.observable.box(0)
  mobx.autorun(() => values.push(observable.get()))

  const increment = mobx.action("increment", amount => {
      observable.set(observable.get() + amount * 2)
      observable.set(observable.get() - amount) // oops
  })

  expect(mobx.isAction(increment)).toBe(true)
  expect(mobx.isAction(function () {})).toBe(false)

  increment(7)

  expect(values).toEqual([0, 7])
})

test("action modifications should be picked up 1", () => {
  const a = mobx.observable.box(1)
  let i = 3
  let b = 0

  mobx.autorun(() => {
      b = a.get() * 2
  })

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(++i)
  })

  action()
  expect(b).toBe(8)

  action()
  expect(b).toBe(10)
})

test("action modifications should be picked up 2", () => {
  const a = mobx.observable.box(1)
  let b = 0

  mobx.autorun(() => {
      b = a.get() * 2
  })

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(a.get() + 1) // ha, no loop!
  })

  action()
  expect(b).toBe(4)

  action()
  expect(b).toBe(6)
})

test("action modifications should be picked up 3", () => {
  const a = mobx.observable.box(1)
  let b = 0

  const doubler = mobx.computed(() => {
   return a.get() * 2
  })

  mobx.observe(
      doubler,
      () => {
          b = doubler.get()
      },
      true
  )

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(a.get() + 1) // ha, no loop!
  })
  
  action()
  expect(b).toBe(4)

  action()
  expect(b).toBe(6)

  a.set(a.get() + 1)
  expect(b).toBe(8)
})


test("test action should be untracked", () => {
  const a = mobx.observable.box(3)
  const b = mobx.observable.box(4)
  let latest = 0
  let runs = 0

  const action = mobx.action(baseValue => {
      b.set(baseValue * 2)
      latest = b.get() // without action this would trigger loop
  })

  const d = mobx.autorun(() => {
      runs++
      const current = a.get()
      action(current)
  })

  expect(b.get()).toBe(6)
  expect(latest).toBe(6)
  // console.log('---1---')
  a.set(7)
  expect(b.get()).toBe(14)
  expect(latest).toBe(14)
  // console.log('--2----')

  a.set(8)
  // console.log('---3---')
  expect(b.get()).toBe(16)
  expect(latest).toBe(16)

  // console.log('---4---')

  b.set(7) // should have no effect
  expect(a.get()).toBe(8)
  expect(b.get()).toBe(7)
  expect(latest).toBe(16) // effect not triggered

  a.set(3)
  expect(b.get()).toBe(6)
  expect(latest).toBe(6)

  expect(runs).toBe(4)

  d()
})


test("should be possible to create autorun in action", () => {
  const a = mobx.observable.box(1)
  const values = []

  const adder = mobx.action(inc => {
      return mobx.autorun(() => {
          values.push(a.get() + inc)
      })
  })

  const d1 = adder(2)
  a.set(3)
  const d2 = adder(17)
  a.set(24)
  d1()
  a.set(11)
  d2()
  a.set(100)

  expect(values).toEqual([3, 5, 20, 26, 41, 28]) // n.b. order could swap as autorun creation order doesn't guarantee stuff
})


// todo 不知道jest测的是啥
// test("should be possible to change unobserved state in an action called from computed", () => {
//   const a = mobx.observable.box(2)

//   const testAction = mobx.action(() => {
//       a.set(3)
//   })

//   const c = mobx.computed(() => {
//       testAction()
//   })

//   expect.assertions(1)
//   mobx.autorun(() => {
//       expect(() => {
//           c.get()
//       }).not.toThrow(/bla/)
//   })

//   mobx._resetGlobalState()
// })


// todo 过于离谱，内存快照都出来了。。
// test("should be possible to change observed state in an action called from computed", () => {
//   const a = mobx.observable.box(2)
//   const d = mobx.autorun(() => {
//       a.get()
//   })

//   const testAction = mobx.action(() => {
//       a.set(5) // this is fine
//       expect(a.get()).toBe(5)
//   })

//   const c = mobx.computed(() => {
//       expect(
//           utils.grabConsole(() => {
//               a.set(4)
//           })
//       ).toMatchInlineSnapshot(
//           `"<STDOUT> [MobX] Side effects like changing state are not allowed at this point. Are you trying to modify state from, for example, a computed value or the render function of a React component? You can wrap side effects in 'runInAction' (or decorate functions with 'action') if needed. Tried to modify: ObservableValue@19"`
//       )
//       expect(a.get()).toBe(4)
//       testAction()
//       return a.get()
//   })

//   expect(c.get()).toBe(5)

//   mobx._resetGlobalState()
//   d()
// })


test("should be possible to change observed state in an action called from computed", () => {
  const a = mobx.observable.box(2)
  const d = mobx.autorun(() => {
      a.get()
  })

  const testAction = mobx.action(() => {
      a.set(3)
  })

  const c = mobx.computed(() => {
      testAction()
      return a.get()
  })

  expect(
      utils.grabConsole(() => {
          c.get()
      })
  ).toBe("")

  mobx._resetGlobalState()
  d()
})


test("action in autorun should be untracked", () => {
  const a = mobx.observable.box(2)
  const b = mobx.observable.box(3)

  const data = []
  const multiplier = mobx.action(val => val * b.get())

  const d = mobx.autorun(() => {
      data.push(multiplier(a.get()))
  })

  a.set(3)
  b.set(4)
  a.set(5)

  d()

  a.set(6)

  expect(data).toEqual([6, 9, 20])
})


test("#286 exceptions in actions should not affect global state", () => {
  let autorunTimes = 0
  function Todos() {
      this.id = 1
      mobx.extendObservable(this, {
          count: 0,
          add: mobx.action(function () {
              this.count++
              // console.log(this)
              // console.log(this, this.count);
              if (this.count === 2) {
                  throw new Error("An Action Error!")
              }
          })
      })
  }
  const todo = new Todos()
  const fn = todo.add;
  mobx.autorun(() => {
      autorunTimes++
      return todo.count
  })
  try {
      // 将this指向window。
      fn()
      expect(window.count).toEqual(NaN)
      todo.add()
      expect(autorunTimes).toBe(2)
      todo.add()
  } catch (e) {
      // console.error(e)
      expect(autorunTimes).toBe(3)
      todo.add()
      expect(autorunTimes).toBe(4)
      // console.log('end')
  }
})


test("runInAction", () => {
  mobx.configure({ enforceActions: "always" })
  const values = []
  const events = []
  const spyDisposer = mobx.spy(ev => {
      if (ev.type === "action")
          events.push({
              name: ev.name,
              arguments: ev.arguments
          })
  })

  const observable = mobx.observable.box(0)
  const d = mobx.autorun(() => values.push(observable.get()))

  let res = mobx.runInAction(() => {
      observable.set(observable.get() + 6 * 2)
      observable.set(observable.get() - 3) // oops
      return 2
  })

  expect(res).toBe(2)
  expect(values).toEqual([0, 9])

  res = mobx.runInAction(() => {
      observable.set(observable.get() + 5 * 2)
      observable.set(observable.get() - 4) // oops
      return 3
  })

  expect(res).toBe(3)
  expect(values).toEqual([0, 9, 15])
  expect(events).toEqual([
      { arguments: [], name: "<unnamed action>" },
      { arguments: [], name: "<unnamed action>" }
  ])

  mobx.configure({ enforceActions: "never" })
  spyDisposer()

  d()
})

test("autorun 嵌套，延迟执行", () => {
  const arr = []
  mobx.runInAction(() => {
    arr.push(-1)
    mobx.autorun(() => {
      arr.push(1)
      mobx.autorun(() => {
        arr.push(5)
      })
      arr.push(2);
      mobx.runInAction(() => {
        arr.push(3)
      })
      mobx.autorun(() => {
        arr.push(6)
      })
      mobx.runInAction(() => {
        arr.push(4)
      })
    })
    arr.push(0)
  })
  expect(arr).toEqual([-1, 0, 1,2,3,4,5,6])
})

test('self case', () => {
  const a = mobx.observable.box(1)
  let b = 0

  const doubler = mobx.computed(() => {
   return a.get() * 2
  })

  const d =  mobx.observe(
      doubler,
      () => {
          b = doubler.get()
      },
      true
  )

  mobx.observe(
      doubler,
       function listener() {
          b = doubler.get()
      },
      false
  )

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(a.get() + 1) // ha, no loop!
  })
  // console.log('--start--', doubler.value.observing.size)
  action()
  expect(b).toBe(4)
  // console.log('d before')
  d()
  // console.log('--end--', doubler.value.observing.size)
  action()
  expect(b).toBe(6)
})

test("action in autorun doesn't keep/make computed values alive", () => {
  let calls = 0
  const myComputed = mobx.computed(() => {
    // console.log('---computed--------')
    return calls++
  })
  const callComputedTwice = () => {
      myComputed.get()
      myComputed.get()
  }

  const runWithMemoizing = fun => {
    // 这里dispose了
      mobx.autorun(fun)()
  }

  callComputedTwice()
  expect(calls).toBe(2)
  // console.log('外层非嵌套不走缓存')
  runWithMemoizing(callComputedTwice)
  // console.log('如果在autorun里第一次不走缓存，后续走缓存');
  expect(calls).toBe(3)

  callComputedTwice()
  // console.log('前面虽然在autorun里监听了，但是已经dispose了，所以不走缓存')
  expect(calls).toBe(5)
  runWithMemoizing(function () {
      mobx.runInAction(callComputedTwice)
  })
  // console.log('如果在action里第一次不走缓存，后续走缓存');
  expect(calls).toBe(6)

  // console.log('---start-----', myComputed)
  callComputedTwice()
  // 通过了
  expect(calls).toBe(8)
})

test("action in autorun doesn't keep/make computed values alive 2", () => {
  let calls = 0
  const myComputed = mobx.computed(() => {
    // console.log('---computed--------')
    return calls++
  })
  const callComputedTwice = () => {
      myComputed.get()
      myComputed.get()
  }

  const runWithMemoizing = fun => {
    // 这里dispose了
    return mobx.autorun(fun)
  }

  callComputedTwice()
  expect(calls).toBe(2)
  // console.log('外层非嵌套不走缓存')
  const d = runWithMemoizing(callComputedTwice)
  // console.log('如果在autorun里第一次不走缓存，后续走缓存');
  expect(calls).toBe(3)

  callComputedTwice()
  // console.log('前面虽然在autorun里监听了，但是已经dispose了，所以不走缓存')
  expect(calls).toBe(3)
  d()
  runWithMemoizing(function () {
      mobx.runInAction(callComputedTwice)
  })()
  // console.log('如果在action里第一次不走缓存，后续走缓存');
  expect(calls).toBe(4)

  // console.log('---start-----', myComputed)
  callComputedTwice()
  // 通过了
  expect(calls).toBe(6)
})

test("action in autorun doesn't keep/make computed values alive 3", () => {
  let calls = 0
  const myComputed = mobx.computed(() => {
    const t = calls
    // console.log('computed-> last:{' + myComputed.value_ + '},current:{' + t + '}')
    return calls++
  })
  const callComputedTwice = () => {
    // 在最外层环境下，只有第一次不走缓存。
    const value = myComputed.get()
    // console.log('---1--', value)
    const value2 = myComputed.get()
    // console.log('---2--', value2)
    // 这里验证了，action外面如果是（autorun，或者action），走缓存
    mobx.runInAction(() => {
      const value3 = myComputed.get()
      // console.log('---3--', value3)
    })
  }

  const runWithMemoizing = fun => {
    // console.log('runWithMemoizing')
    mobx.autorun(fun)();
  }

  // callComputedTwice()
  // console.log('a', calls)
  // expect(calls).toBe(2)
  // runWithMemoizing(callComputedTwice)
  // console.log('b', calls)


  // callComputedTwice()

  // console.log('c', calls, globalState.isInAction, globalState.trackingReaction)
  myComputed.get()
  expect(calls).toBe(1)
  // console.log('b1')
  let d
  mobx.autorun(() => {
      // console.log('autorun4')
      myComputed.get()
      expect(calls).toBe(2)
      // console.log('get before5')
      myComputed.get()

     d = mobx.autorun(() => {
        // console.log('autorun4')
        myComputed.get()
        // console.log('get before5')
        myComputed.get()
      });
    })();
    expect(calls).toBe(2)
  // console.log('b2')
   mobx.autorun(() => {
      // console.log('autorun2')
      myComputed.get()
      // console.log('get before3')
      myComputed.get()
      mobx.runInAction(() => {
        callComputedTwice()
        mobx.runInAction(() => {
          callComputedTwice()
        });
      });
    })();
    expect(calls).toBe(2)
    // console.log('c1');
    d()
    mobx.runInAction(callComputedTwice);
    expect(calls).toBe(3)
    // console.log('d1')
    // console.log('debugger')
   const d2 = mobx.autorun(callComputedTwice)
    expect(calls).toBe(4)
    // console.log('c2');
    myComputed.get();
    expect(calls).toBe(4)
    // console.log('c3');
    d2()
    myComputed.get();
    expect(calls).toBe(5)
    // console.log('c4');
    const d3 =  mobx.autorun(() => {
      // console.log('autorun')
      myComputed.get()
      // console.log('get before')
      myComputed.get()

    })
    expect(calls).toBe(6)
    // console.log('c5');
   mobx.runInAction(callComputedTwice);
    expect(calls).toBe(6)
    // console.log('c6');
    myComputed.get();
    expect(calls).toBe(6)

    runWithMemoizing(callComputedTwice)
    expect(calls).toBe(6)
    // console.log('c7');
    d3()
    myComputed.get();
    expect(calls).toBe(7)
    // console.log('c8');


  // runWithMemoizing(function () {

  //  })
  // console.log('d', calls)
  // callComputedTwice()
  // console.log('e', calls)
  // callComputedTwice()
})

test("computed values and actions", () => {
  let calls = 0

  const number = mobx.observable.box(1)
  // console.log(number.name);
  const squared = mobx.computed('mytest computed', () => {
      calls++
      // console.log('computed', calls);
      return number.get() * number.get()
  })
  const changeNumber10Times = mobx.action(() => {
      squared.get()
      // console.log('run1')
      squared.get()
      // console.log('run2')
      for (let i = 0; i < 10; i++){
        const v = number.get()
        number.set(v + 1)
      }
  })

  changeNumber10Times()
  expect(calls).toBe(1)
  mobx.autorun(() => {

      changeNumber10Times()
      expect(calls).toBe(2)
  })()
  expect(calls).toBe(2)

  changeNumber10Times()
  expect(calls).toBe(3)
})

test('----computed-----', () => {
  const a = mobx.observable.box(1)
  const b = mobx.observable.box(2)
  let calls = 0
  const c = mobx.computed(() => {
   return a.get() + b.get()
  })
  let ans = []
  mobx.autorun(() => {
    const v = c.get()
    calls++;
    ans.push(v)
  })

  expect(calls).toBe(1)
  expect(ans).toEqual([3])

  // a.set(2)
  // b.set(2)
  mobx.runInAction(() => {
    a.set(2)
    b.set(6)
  })
  expect(calls).toBe(2)
  expect(ans).toEqual([3, 8])
  b.set(1)
  expect(calls).toBe(3)
  expect(ans).toEqual([3, 8, 3])
  mobx.runInAction(() => {
    a.set(1)
    b.set(2)
  })
  expect(calls).toBe(3)
  expect(ans).toEqual([3, 8, 3])
})

test("action should not be converted to computed when using (extend)observable", () => {
  const a = mobx.observable({
      a: 1,
      b: mobx.action(function () {
          this.a++
      }),
      d: mobx.action.bound(function() {
        return this;
      }),
      e: mobx.action(function() {
        return this;
      })
  })

  expect(mobx.isAction(a.b)).toBe(true)
  a.b()
  expect(a.a).toBe(2)

  expect(a.d()).toBe(a)
  const fn = a.d
  expect(fn()).toBe(a)

  expect(a.e()).toBe(a)
  const fn2 = a.e
  expect(fn2()).toBe(window)


  mobx.extendObservable(a, {
      c: mobx.action(function () {
          this.a *= 3
      })
  })

  expect(mobx.isAction(a.c)).toBe(true)
  a.c()
  expect(a.a).toBe(6)
})

test("extendObservable respects action decorators", () => {
  const x = mobx.observable(
      {
          a1() {
              return this
          },
          a2() {
              return this
          },
          a3() {
              return this
          }
      },
      {
          a1: mobx.action,
          a2: mobx.action.bound,
          a3: false
      }
  )

  expect(mobx.isAction(x.a1)).toBe(true)
  expect(mobx.isAction(x.a2)).toBe(true)
  expect(mobx.isAction(x.a3)).toBe(false)

  const global = (function() {
      return this
  })()

  const { a1, a2, a3 } = x
  expect(a1.call(x)).toBe(x)
  expect(a1()).toBe(global)
  expect(a2.call(x)).toBeTruthy() // it is not this! proxies :) see test in proxies.js
  expect(a2()).toBeTruthy()
  expect(a2()).toBe(x)
  expect(a3.call(x)).toBe(x)
  expect(a3()).toBe(global)
})

test("bound actions bind", () => {
  let called = 0
  const x = mobx.observable(
      {
          y: 0,
          z: function (v) {
              this.y += v
              this.y += v
          },
          get yValue() {
              // console.log(mobx.globalState.isInComputedMethod)
              called++
              return this.y
          }
      },
      {
          z: mobx.action.bound
      }
  )

  // 这里订阅，computed， 
  const d = mobx.autorun(() => {
    x.yValue
  })
  const events = []
  const d2 = mobx.spy(e => events.push(e))

  const runner = x.z
  runner(3)
  expect(x.yValue).toBe(6)
  
  expect(called).toBe(2)

  expect(events.filter(e => e.type === "action").map(e => e.name)).toEqual(["z"])
  expect(Object.keys(x)).toEqual(["y"])

  d()
  d2()
})

test("Fix #1367", () => {
  const x = mobx.extendObservable(
      {},
      {
          method() {}
      },
      {
          method: mobx.action
      }
  )
  expect(mobx.isAction(x.method)).toBe(true)
})

test("given actionName, the action function name should be defined as the actionName", () => {
  const a1 = mobx.action("testAction", () => {})
  expect(a1.name).toBe("testAction")
})

test("given anonymous action, the action name should be <unnamed action>", () => {
  const a1 = mobx.action(() => {})
  expect(a1.name).toBe("<unnamed action>")
})


test("given function declaration, the action name should be as the function name", () => {
  const a1 = mobx.action(function testAction() {})
  expect(a1.name).toBe("testAction")
})

test("test object", function () {
  let a = mobx.observable({
     b: {
       c: 1
     }
  })
  let q = a.b;
  const arr = []
  let calls1 = 0;
  let calls2 = 0;
  mobx.autorun(()=> {
    calls1++
    arr.push(a.b)
  })
 
  mobx.autorun(()=> {
    calls2++
    arr.push(a.b.c)
  })
 

  mobx.runInAction(()=> {
   a.b.c +=1;
  })
  expect(calls1).toBe(1)
  expect(calls2).toBe(2)
  arr.push('start')
  mobx.runInAction(()=> {
   a.b.c = 2;
  })
  expect(calls1).toBe(1)
  expect(calls2).toBe(2)
  arr.push('end')
  mobx.runInAction(()=> {
   a.b = 2;
  })
  expect(calls1).toBe(2)
  expect(calls2).toBe(3)
  mobx.runInAction(()=> {
   a.b = q;
  })

  mobx.runInAction(()=> {
   a.b.c = 4;
  })
  expect(calls1).toBe(3)
  expect(calls2).toBe(5)
  expect(arr[0]).toBe(q)
  expect(arr.slice(1)).toEqual([ 1, 2, 'start', 'end', 2, undefined, q, 2, 4 ])
  mobx.runInAction(()=> {
    a.b = { c: 2 };
    q.c = 5
    a.b = q;
  })
  expect(calls1).toBe(4)
  expect(calls2).toBe(6)
  expect(arr[0]).toBe(q)
  expect(arr.slice(1)).toEqual([ 1, 2, 'start', 'end', 2, undefined, q, 2, 4, q, 5 ])
  
 })

 test("test object2", function () {
  let a = mobx.observable({
     b: {
       c: 1
     }
  })
  let q = a.b;
  const arr = []
  let calls1 = 0;
  let calls2 = 0;
  mobx.autorun(()=> {
    calls1++
    arr.push(a.b)
  })
 
  mobx.autorun(()=> {
    calls2++
    arr.push(a.b.c)
  })
 

  mobx.runInAction(()=> {
   a.b.c +=1;
  })
  expect(calls1).toBe(1)
  expect(calls2).toBe(2)
  arr.push('start')
  mobx.runInAction(()=> {
   a.b.c = 2;
  })
  expect(calls1).toBe(1)
  expect(calls2).toBe(2)
  arr.push('end')
  mobx.runInAction(()=> {
   a.b = 2;
  })
  expect(calls1).toBe(2)
  expect(calls2).toBe(3)
  mobx.runInAction(()=> {
   a.b = q;
  })

  mobx.runInAction(()=> {
   a.b.c = 4;
  })
  expect(calls1).toBe(3)
  expect(calls2).toBe(5)
  expect(arr[0]).toBe(q)
  expect(arr.slice(1)).toEqual([ 1, 2, 'start', 'end', 2, undefined, q, 2, 4 ])
  mobx.runInAction(()=> {
    let ttt = a.b
    ttt.c = 2
    a.b = ttt;
  })
  expect(calls1).toBe(3)
  expect(calls2).toBe(6)
  expect(arr[0]).toBe(q)
  expect(arr.slice(1)).toEqual([ 1, 2, 'start', 'end', 2, undefined, q, 2, 4, 2 ])
  
 })


 test("test computed wrap", () => {
  let calls1 = 0;
  let calls2 = 0;
  const a = mobx.observable.box(1)
  // console.log(a.name)
  const b = mobx.observable.box(2)

  const c = mobx.computed('-C-', () => {
    arr.push([a.get(), b.get()])
    // console.log('c computed',)
    calls1++;
    return a.get() + b.get()
  });

  const d = mobx.computed('-D-',() => {
    arr.push('d')
    // console.log('d computed', _.cloneDeep(d))
    const ret = c.get()
    // console.log('d computed', _.cloneDeep(d))
    arr.push('c')
    // console.log('c in d')
    calls2++;
    arr.push(c.get())
    // console.log('arr push')
    return  ret + a.get()
  })

  const arr = []
  mobx.autorun(() => {
    // console.log('d autorun')
    arr.push(['d', d.get()])
    // console.log('d autorun end', _.cloneDeep(d))
  })
  
  expect(arr).toEqual(['d',[1,2], 'c', 3, ['d', 4]])
  expect(calls1).toBe(1)
  expect(calls2).toBe(1)
  // console.log('-----start-----')
  mobx.runInAction(() => {
    b.set(3)
  })

  expect(arr).toEqual(['d',[1,2], 'c', 3, ['d', 4],
   [1,3], 'd', 'c', 4, ['d', 5]])
  expect(calls1).toBe(2)
  expect(calls2).toBe(2)

  // console.log('---------------1111111111111---------------------------')
  mobx.runInAction(() => {
    a.set(7)
  })
  // console.log(c, d)
  // console.log(arr);
  // 预期 'd', [7, 3], 'c', 10, ['d',17]
  // 当前 [7,3],"d","c",10,["d",17],"d","c",10] 
  expect(arr).toEqual(['d',[1,2], 'c', 3, ['d', 4], [1,3], 'd', 'c', 4, ['d', 5],
   'd', [7, 3], 'c', 10, ['d',17]])
  expect(calls1).toBe(3)
  expect(calls2).toBe(3)
})

test("test computed wrap2", () => {
  let calls1 = 0;
  let calls2 = 0;
  const a = mobx.observable.box(1)
  const b = mobx.observable.box(2)
  const c = mobx.computed(() => {
    // console.log('c computed')
    arr.push([a.get(), b.get()])
    calls1++;
    return a.get() + b.get()
  })
  const d = mobx.computed(() => {
    // console.log('d computed')
    const rest = a.get();
    arr.push('d')
    // console.log('c.get before')
    const ret = c.get()
    // console.log('c.get after')
    arr.push('c')
    calls2++;
    arr.push(c.get())
    return  ret + rest;
  })
  const arr = []
  mobx.autorun(() => {
    // console.log('c autorun')
    c.get()
  })
  mobx.autorun(() => {
    arr.push(['d', d.get()])
  })

  expect(arr).toEqual([[1,2],"d","c",3,["d",4]])
  expect(calls1).toBe(1)
  expect(calls2).toBe(1)
  // console.log('debugger1')
  mobx.runInAction(() => {
    b.set(3)
  })

  expect(arr).toEqual([[1,2],"d","c",3,["d",4],
  [1,3],"d","c",4,["d",5]])
  expect(calls1).toBe(2)
  expect(calls2).toBe(2)
  // console.log('debugger2')
  mobx.runInAction(() => {
    a.set(7)
  })
  expect(arr).toEqual([[1,2],"d","c",3,["d",4],[1,3],"d","c",4,["d",5],
  [7,3],"d","c",10,["d",17]]
  )
  expect(calls1).toBe(3)
  expect(calls2).toBe(3)
 
})

test("test computed wrap5", () => {
  let calls1 = 0;
  let calls2 = 0;
  const a = mobx.observable.box(1)
  const b = mobx.observable.box(2)
  const c = mobx.computed(() => {
    // console.log('c computed')
    arr.push('c computed')
    arr.push([a.get(), b.get()])
    calls1++;
    return a.get() + b.get()
  })
  const d = mobx.computed(() => {
    // console.log('d computed')
    const rest = a.get();
    arr.push('d')
    // console.log('c.get before')
    const ret = c.get()
    // console.log('c.get after')
    arr.push('c')
    calls2++;
    arr.push(c.get())
    return  ret + rest;
  })
  const arr = []
  mobx.autorun(() => {
    // console.log('c autorun')
    arr.push('c autorun')
    c.get()
    b.get()
  })
  mobx.autorun(() => {
    arr.push(['d', d.get()])
  })

  expect(arr).toEqual(["c autorun","c computed",[1,2],"d","c",3,["d",4]])
  expect(calls1).toBe(1)
  expect(calls2).toBe(1)
  // console.log('debugger1')
  // console.log(_.cloneDeep(c))
  mobx.runInAction(() => {
    b.set(3)
  })
  // console.log(_.cloneDeep(c))
  expect(arr).toEqual(["c autorun","c computed",[1,2],"d","c",3,["d",4],"c autorun","c computed",[1,3],"d","c",4,["d",5]])
  expect(calls1).toBe(2)
  expect(calls2).toBe(2)
  // console.log('debugger2')
  mobx.runInAction(() => {
    a.set(7)
  })
  expect(arr).toEqual(["c autorun","c computed",[1,2],"d","c",3,["d",4],"c autorun","c computed",[1,3],"d","c",4,["d",5],
  "c computed",[7,3],"c autorun","d","c",10,["d",17]]
  )
  expect(calls1).toBe(3)
  expect(calls2).toBe(3)
 
})


test("test computed wrap3", () => {
  let calls1 = 0;
  let calls2 = 0;
  const a = mobx.observable.box(1)
  const b = mobx.observable.box(2)
  const c = mobx.computed(() => {
    // console.log('c computed')
    arr.push([a.get(), b.get()])
    calls1++;
    return a.get() + b.get()
  })
  const d = mobx.computed(() => {
    // console.log('d computed')
    const rest = a.get();
    arr.push('d')
    // console.log('c.get before')
    const ret = c.get()
    // console.log('c.get after')
    arr.push('c')
    calls2++;
    arr.push(c.get())
    return  ret + rest;
  })
  const arr = []
  c.get()
  mobx.autorun(() => {
    arr.push(['d', d.get()])
  })

  expect(arr).toEqual([[1,2],"d",[1,2],"c",3,["d",4]])
  expect(calls1).toBe(2)
  expect(calls2).toBe(1)
  // console.log('debugger1')
  mobx.runInAction(() => {
    b.set(3)
  })

  expect(arr).toEqual([[1,2],"d",[1,2],"c",3,["d",4],
  [1,3],"d","c",4,["d",5]])
  expect(calls1).toBe(3)
  expect(calls2).toBe(2)
  // console.log('debugger2')
  mobx.runInAction(() => {
    a.set(7)
  })
  expect(arr).toEqual([[1,2],"d",[1,2],"c",3,["d",4],[1,3],"d","c",4,["d",5],
  "d",[7,3],"c",10,["d",17]]
  )
  expect(calls1).toBe(4)
  expect(calls2).toBe(3)
 
})


test("test computed wrap4", () => {
  let calls1 = 0;
  let calls2 = 0;
  const a = mobx.observable.box(1)
  const b = mobx.observable.box(2)
  const arr = []

  // mobx.spy((e) => {
  //   console.log(e);
  // });
  const f = mobx.observable.box(12)

  const c = mobx.computed(() => {
    // console.log('c computed')
    arr.push(['c computed', a.get(), b.get()])
    calls1++;
    return a.get() + b.get()
  })

  const h = mobx.computed(() => {
    // console.log('h computed')
    arr.push('h computed')
    return f.get() + b.get()
  })


  const d = mobx.computed(() => {
    // console.log('d computed')
    const rest = a.get();
    arr.push('d')
    const ret1 = h.get()
    const ret = c.get()
    arr.push('c')
    calls2++;
    arr.push(c.get())
    // console.log('d computed return')
    return  ret + rest + ret1;
  })


  const g = mobx.action(() => {
    f.set(24)
  })
  // a1 b2 c3 d5 f6 h7
  // console.log('start', a.name_, b.name_, c.name_, d.name_, f.name_, h.name_)
  // c.get()
  // h.get()
  // console.log('debugger0')


  mobx.autorun(() => {
    // console.log('7 start')
    arr.push(['d', d.get()])
    // console.log('run g')
    g('这是g')
    // console.log('7 end')
  })
  expect(arr).toEqual(["d","h computed",["c computed",1,2],"c",3,["d",18],"h computed","d","c",3,["d",30]])
  expect(calls1).toBe(1)
  expect(calls2).toBe(2)
  arr.splice(0, arr.length)
  mobx.autorun(() => {
    // console.log('3 start')
    arr.push(['c autorun', c.get()])
    // console.log('3 end')
  })
  expect(arr).toEqual([["c autorun",3]])
  expect(calls1).toBe(1)
  expect(calls2).toBe(2)
  arr.splice(0, arr.length)
  // console.log('debugger1')
  mobx.runInAction(() => {
    b.set(3)
  })
  expect(arr).toEqual(["h computed","d",["c computed",1,3],"c",4,["d",32],["c autorun",4]])
  expect(calls1).toBe(2)
  expect(calls2).toBe(3)
  arr.splice(0, arr.length)
// h ->c

//  c -> a, b
//  d -> a, c, h
//  h -> f, b

  // console.log('debugger2')
  mobx.runInAction(() => {
    a.set(7)
  })
  expect(arr).toEqual(["d",["c computed",7,3],"c",10,["d",44],["c autorun",10]])
  expect(calls1).toBe(3)
  expect(calls2).toBe(4)
})

 

// test("test array1", function () {
//   const a = observable.array([])
//   expect(a.length).toBe(0)
//   expect(Object.keys(a)).toEqual([])
//   expect(a.slice()).toEqual([])
  
//   a.push(1)
//   expect(a.length).toBe(1)
//   expect(a.slice()).toEqual([1])

//   a[1] = 2
//   expect(a.length).toBe(2)
//   expect(a.slice()).toEqual([1, 2])

//   const sum = mobx.computed(function () {
//       return (
//           -1 +
//           a.reduce(function (a, b) {
//               return a + b
//           }, 1)
//       )
//   })

//   expect(sum.get()).toBe(3)

//   a[1] = 3
//   expect(a.length).toBe(2)
//   expect(a.slice()).toEqual([1, 3])
//   expect(sum.get()).toBe(4)

//   a.splice(1, 1, 4, 5)
//   expect(a.length).toBe(3)
//   expect(a.slice()).toEqual([1, 4, 5])
//   expect(sum.get()).toBe(10)
  
//   a.replace([2, 4])
//   expect(sum.get()).toBe(6)

//   a.splice(1, 1)
//   expect(sum.get()).toBe(2)
//   expect(a.slice()).toEqual([2])

//   a.spliceWithArray(0, 0, [4, 3])
//   expect(sum.get()).toBe(9)
//   expect(a.slice()).toEqual([4, 3, 2])

//   a.clear()
//   expect(sum.get()).toBe(0)
//   expect(a.slice()).toEqual([])

//   a.length = 4
//   expect(_.isNaN(sum.get())).toBe(true)
//   expect(a.length).toEqual(4)

//   expect(a.slice()).toEqual([undefined, undefined, undefined, undefined])

//   a.replace([1, 2, 2, 4])
//   expect(sum.get()).toBe(9)
//   a.length = 4
//   expect(sum.get()).toBe(9)

//   a.length = 2
//   expect(sum.get()).toBe(3)
//   expect(a.slice()).toEqual([1, 2])

//   expect(a.reverse()).toEqual([2, 1])
//   expect(a).toEqual([2, 1])
//   expect(a.slice()).toEqual([2, 1])

//   a.unshift(3)
//   expect(a.sort()).toEqual([1, 2, 3])
//   expect(a).toEqual([1, 2, 3])
//   expect(a.slice()).toEqual([1, 2, 3])

//   expect(JSON.stringify(a)).toBe("[1,2,3]")

//   expect(a[1]).toBe(2)
//   a[2] = 4
//   expect(a[2]).toBe(4)

//   expect(Object.keys(a)).toEqual(["0", "1", "2"])
// })

// test("test array2", function () {
//   let a = mobx.observable.array([{a: 1, b: 2 }, 3])
//   console.log(a)
//   mobx.autorun(()=> {
//    a[0]?.a;
//      console.log('change1')
//   })
 
//   mobx.autorun(()=> {
//    a[1];
//      console.log('change2')
//   })
 
//   mobx.autorun(()=> {
//    a;
//      console.log('change3')
//   })
 
//   mobx.runInAction(()=> {
//    a.push(4)
//   })
 
//   mobx.runInAction(()=> {
//    a.splice(0, 3)
//   })
  
//  })
 

let topTestCase = false;
const toggleBtn = document.getElementById('toggleBtn')
const debuggerBtn = document.getElementById('debuggerBtn');
function run () {
  mobx._resetGlobalState();
  try{
    // 这里执行
    list.slice(topTestCase ? -1: 0).map(([name, cb]) => {
      console.log('-------' + name + '-------')
      cb()
    })
  }catch(e) {
    console.error(e)
  }
  toggleBtn.innerHTML = topTestCase ? '当前最新，点击测试全部' : '当前全部，点击测试最新'
  debuggerBtn.innerHTML = !mobx.globalState.logger ? '当前隐藏，点击展示log' : '当前展示，点击隐藏log'
}
run();

if (toggleBtn instanceof HTMLButtonElement) {
  toggleBtn.onclick = () => {
    topTestCase = !topTestCase
    console.clear();
    run()
  }
}

if (debuggerBtn instanceof HTMLButtonElement) {
  debuggerBtn.onclick = () => {
    mobx.globalState.logger = !mobx.globalState.logger;
    console.clear();
    run()
  }
}
