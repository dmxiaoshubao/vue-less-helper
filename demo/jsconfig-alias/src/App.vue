<template>
  <div class="test">Hello Vue</div>
</template>

<style lang="less" scoped>
@import (reference) "~/styles/mixins.less";
@import (reference) "~/styles/variables.less";
.test {
  /*
    你可以尝试在下面这几行的不同位置重新输入或者触发补全：
    测试无参数 mixin (.flex-center 没有参数):
  */
  .flex-center;
  .flex-center;
  .flex-center;

  /*
    测试有参数 mixin (.border-radius 有参数 @r):
  */
  .border-radius();
  .border-radius;
  .border-radius();

  /*
    测试多参数/默认值 mixin (.box-shadow):
  */
  .box-shadow();
  .box-shadow();
  .box-shadow();

  /*
    测试不定参数 mixin (.transition):
  */
  .transition;
  .transition;
  .transition(all 0.3s ease);

  /*
    demo 项目专属 mixin:
  */
  .js-flex-center;
  .js-box-shadow;
  .js-transition;

  /*
    测试作为 mixin 使用的普通 class (.clearfix):
  */
  .clearfix;
  .clearfix;

  /*
    测试变量 (@my-color):
  */
  color: @my-color;
  color: @my-color; // 水电费
}
</style>
