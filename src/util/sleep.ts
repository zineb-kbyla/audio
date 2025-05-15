const sleep = (time: number) =>
  new Promise((resolve) => {
    setTimeout(() => resolve(true), time);
  });
export default sleep;
