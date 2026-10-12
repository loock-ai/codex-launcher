// 所有入口共用初始化屏障；命令串行执行，失败不会阻塞下一条。
exports.createCommandHandler = function ({ready, start, openWeb, showPanel}) {
 let queue = Promise.resolve();
 return function (argv) {
  const open = argv.includes('--open-web');
  const action = async () => {
   await ready;
   if (!open) showPanel();
   await start();
   if (open) await openWeb();
  };
  const result = queue.then(action, action);
  queue = result.catch(() => {});
  return result;
 };
};
