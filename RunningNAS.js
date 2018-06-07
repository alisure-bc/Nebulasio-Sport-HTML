"use strict";

//健康走步参与者，数据结构
var Walker = function(jsonStr) {
    if (jsonStr) {
        var obj = JSON.parse(jsonStr);
        this.address = obj.address;//地址
        this.nickName = obj.nickName;//昵称
        this.steps = obj.steps;//步数
        this.award = 0;
        this.uploadTime = obj.uploadTime;//上传时间
    } else {
        this.address = "";
        this.nickName = "";
        this.steps = "";
        this.uploadTime = "";
        this.award = 0;
    }
};

Walker.prototype = {
    toString: function() {
        return JSON.stringify(this);
    }
};

var Record = function(jsonStr) {
    if (jsonStr) {
        var obj = JSON.parse(jsonStr);
        this.totalNum = obj.totalNum;//参与总人数
        this.totalAward = obj.totalAward;//总奖励
        this.numOfAward = obj.numOfAward;//得到奖励的人数
    } else {
        this.totalNum = 0;
        this.totalAward = 0;
        this.numOfAward = 0;
    }
};

Record.prototype = {
    toString: function() {
        return JSON.stringify(this);
    }
};

var CompeteWalkStepContract = function() {
    LocalContractStorage.defineProperty(this, "adminAddress"); //管理员账户地址
    LocalContractStorage.defineProperty(this, "contractValue");
    LocalContractStorage.defineProperty(this, "walkChainNumber");//当前总共发起的链数量,编号0,1,2,3...
    LocalContractStorage.defineProperty(this, "totalWalkerNumber");//池中总的参与人
    
    LocalContractStorage.defineMapProperty(this, "walkerPool", {// 0 walker1 1 walker2 ....
        //总的参与者计步的人，当天内每个人的步数可以更新，不同天数可以重复

        parse: function(jsonText) {
            return new Walker(jsonText);
        },
        stringify: function(obj) {
            return obj.toString();
        }
    });
    // 0 "2018-06-02"
    // 1 "2018-06-03"
    LocalContractStorage.defineMapProperty(this, "walkerChains");//目前总的发起链

    //记录每天的所有记录在池中的开始索引和结束索引
    //"2018-06-02" 0  0
    //"2018-06-03" 1  6
    //......
    LocalContractStorage.defineMapProperty(this, "walkerChainStartIndex");
    //每天所有人编号链表 （0 "2018-06-02"，“编号。。。”）
    //              （1 "2018-06-03","编号。。。"）
    LocalContractStorage.defineMapProperty(this, "historyDayWalker");//每个记录记的是每个链的所有人编号
    LocalContractStorage.defineMapProperty(this, "sortDayWalker");//每个记录记的是每个链排序后的所有人编号
    //奖励记录
    LocalContractStorage.defineMapProperty(this, "awardRecord", {
        parse: function(jsonText) {
            return new Record(jsonText);
        },
        stringify: function(obj) {
            return obj.toString();
        }
    });
};

CompeteWalkStepContract.prototype = {
    init: function() {
        this.adminAddress = Blockchain.transaction.from;
        this.contractValue = 0;
        this.walkChainNumber = 0;
        this.totalWalkerNumber = 0;
    },

    chongZhi: function() {
        var from = Blockchain.transaction.from;
        var value = Blockchain.transaction.value;

        if(from != this.adminAddress) {
            throw new Error("只有部署账户可以充值。。");
        }
        this.contractValue = this.contractValue + value;
        //return this.contractValue;
    },
    //转账+提现_value的单位是 wei
    /*zhuanZhang: function(_address, _value) {
        var from = Blockchain.transaction.from;
        if(from != this.adminAddress) {
            throw new Error("只有部署账户可以转发合约里面的钱。。");
        }
        if(_value > this.contractValue) {
            throw new Error("合约里账户钱不够，还剩" + this.contractValue + "NAS.");
        }
        var result = Blockchain.transfer(_address, _value); //金额转入账户
        if (!result) {
            Event.Trigger("AwardTransferFailed", {
                Transfer: {
                    from: Blockchain.transaction.to,
                    to: _address,
                    value: _value
                }
            });

            throw new Error("Award transfer failed. Address:" + _address + ", Wei:" + _value);
        }
        Event.Trigger("WinAwardTransfer", {
            Transfer: {
                from: Blockchain.transaction.to,
                to: _address,
                value: _value
            }
        });
        this.contractValue = this.contractValue - _value;
        //return "[" + _value + "," + this.contractValue + "]";
    },*/
    //查看合约里余额
    checkBalance:function() {
        var from = Blockchain.transaction.from;
        if(from != this.adminAddress) {
            throw new Error("只有部署账户可以查看合约里面的钱。。");
        }
        return this.contractValue;
    },
    deposit:function(_value) {
        var from = Blockchain.transaction.from;
        if(from != this.adminAddress) {
            throw new Error("只有部署账户可以提现合约里面的钱。。");
        }
        if(_value > this.contractValue) {
            throw new Error("合约里账户钱不够，还剩" + this.contractValue + "Wei.");
        }
        var result = Blockchain.transfer(from, _value); //金额转入账户
        if (!result) {
            Event.Trigger("AwardTransferFailed", {
                Transfer: {
                    from: Blockchain.transaction.to,
                    to: from,
                    value: _value
                }
            });

            throw new Error("Award transfer failed. Address:" + from + ", Wei:" + _value);
        }
        Event.Trigger("WinAwardTransfer", {
            Transfer: {
                from: Blockchain.transaction.to,
                to: from,
                value: _value
            }
        });
        this.contractValue = this.contractValue - _value;
        return true;
    },
    //添加walker，如果今天结算时间没有截止
    //                  如果该walker已经添加，则更新他之前的记录
    //                  如果该walker没有添加，则直接添加记录
    //            如果今天结算时间已经截止，则新建一条链
    addWalker: function(_nickName, _steps) {

        var walker = new Walker();
        walker.address = Blockchain.transaction.from;
        walker.nickName = _nickName;
        walker.steps = _steps;
        walker.uploadTime = this._getCurrentTime();

        var dateStr = this._getDateCurrentTime(walker.uploadTime);
        //console.log(dateStr);
        //如果添加walker的日期与walkerChains里面当前存储日期，则添加一条walk链
        if(this.walkerChains.get(this.walkChainNumber-1) != dateStr) {
            
            this.walkerChainStartIndex.put(this.walkChainNumber, this.totalWalkerNumber);//为新链添加其开始索引
            this.walkerPool.put(this.totalWalkerNumber, walker); //添加到池中
            this.walkerChains.put(this.walkChainNumber, dateStr);//添加链map，日期     
            this.totalWalkerNumber++;//池中walker加1
            this.walkChainNumber++;//链数量加1
            
            this._getHistoryWalkerChainFromDate(dateStr);
            this._getSortWalkerChainFromDate(dateStr);
            //return true;
            return this.walkChainNumber + " " + this.totalWalkerNumber + " " + this.walkerPool.get(this.totalWalkerNumber-1) 
                + " " + this.walkerChains.get(this.walkChainNumber-1) + " " + this.walkerChainStartIndex.get(this.walkChainNumber-1);
        } else {
            //添加到当前已有链
            //如果添加walker的日期与walkerChains当前存储日期相等，则直接覆盖地址相等的记录
            //从当前链的开始索引找地址相同的替换，如果找不到则添加
            var start = this.walkerChainStartIndex.get(this.walkChainNumber-1);
            for(var i = start; i < this.totalWalkerNumber; i++) {
                if(this.walkerPool.get(i).address == walker.address) {
                    this.walkerPool.put(i, walker);
                    this._getHistoryWalkerChainFromDate(dateStr);
                    this._getSortWalkerChainFromDate(dateStr);
                    return true;//找到相同的就替换并返回true添加成功
                }
            }
            //找不到相同的
            this.walkerPool.put(this.totalWalkerNumber, walker);
            this.totalWalkerNumber++;
            this._getHistoryWalkerChainFromDate(dateStr);
            this._getSortWalkerChainFromDate(dateStr);
            //return true;
            return this.walkChainNumber + " " + this.totalWalkerNumber + " " + this.walkerPool.get(this.totalWalkerNumber-1) 
                + " " + this.walkerChains.get(this.walkChainNumber-1) + " " + this.walkerChainStartIndex.get(this.walkChainNumber-1);
        }
    },
    //获得某个日期的排行榜
    getRankingListFromDate:function(_date) {
        //this._getHistoryWalkerChainFromDate(_date);
        //this._getSortWalkerChainFromDate(_date);
        var sortChain = this.sortDayWalker.get(_date);
        var sortArray = sortChain.split(",");
        var result = "[";

        var walker;
        for (var i = 0; i < sortArray.length; i++) {
            walker = this.walkerPool.get(parseInt(sortArray[i]));
            result += JSON.stringify(walker) + ",";
        }
        result = result.substring(0, result.length-1);
        result += "]";
        return result;
    },
    
    //分发奖励，管理人员根据每天的步数排行榜进行定制分发奖励机制
    //         参数：获奖人数，总奖励金额，日期
    putRewardForDate:function(_count, _totalAward, _date) {
        if(Blockchain.transaction.from != this.adminAddress) {
            //throw new Error("Permission denied.");
            return -3;
        }
        if(_totalAward > this.contractValue) {
            //throw new Error("合约里账户钱不够，还剩" + this.contractValue + "Wei.");
            return -2;
        }
        var ChainNum;
        for(var i = 0; i< this.walkChainNumber; i++) {
            if(this.walkerChains.get(i) == _date) {
                ChainNum = i;
                break;
            }
        }
        if(ChainNum == undefined) {
            //throw new Error("Query date error, no such date.");
            return -1;
        }
        /*if(_date == this.walkerChains.get(this.walkChainNumber-1)) {
            //throw new Error("The date is not up yet!");
            return 0;
        }*/
        var limit = _count / 3;
        //如果日期合理
        var perAward1 = _totalAward * 0.5 * 3 / _count;
        var perAward2 = _totalAward * 0.3 * 3 / _count;
        var perAward3 = _totalAward * 0.2 * 3 / _count;

        //this._getHistoryWalkerChainFromDate(_date);
        //this._getSortWalkerChainFromDate(_date);
        var sortChain = this.sortDayWalker.get(_date);
        var sortArray = sortChain.split(",");

        for(var i = 0; i < sortArray.length; i++) {
            if(i >_count) {
                break;
            }
            var result;
            var address = this.walkerPool.get(parseInt(sortArray[i])).address;
            if(i + 1 <= limit) {
                result = Blockchain.transfer(address, perAward1);//wei
                if(!result) {
                    Event.Trigger("AwardTransferFailed", {
                        Transfer: {
                            from: Blockchain.transaction.to,
                            to: address,
                            value: perAward1
                        }
                    });
                    throw new Error("Award transfer failed. Walker Address:" + address + ", NAS(wei):" + perAward1);
                }  
                Event.Trigger("WinAwardTransfer", {
                    Transfer: {
                        from: Blockchain.transaction.to,
                        to: address,
                        value: perAward1
                    }
                });
                this.contractValue = this.contractValue - perAward1;
                var walker = new Walker();
                walker = this.walkerPool.get(parseInt(sortArray[i]));
                walker.award = perAward1;
                this.walkerPool.set(parseInt(sortArray[i]), walker);
            }
            if((i + 1 > limit) && (i + 1 <= 2*limit)) {
                result = Blockchain.transfer(address, perAward2);//wei
                if(!result) {
                    Event.Trigger("AwardTransferFailed", {
                        Transfer: {
                            from: Blockchain.transaction.to,
                            to: address,
                            value: perAward2
                        }
                    });
                    throw new Error("Award transfer failed. Walker Address:" + address + ", NAS(wei):" + perAward2);
                }  
                Event.Trigger("WinAwardTransfer", {
                    Transfer: {
                        from: Blockchain.transaction.to,
                        to: address,
                        value: perAward2
                    }
                });
                this.contractValue = this.contractValue - perAward2;
                var walker = new Walker();
                walker = this.walkerPool.get(parseInt(sortArray[i]));
                walker.award = perAward2;
                this.walkerPool.set(parseInt(sortArray[i]), walker);
            }
            if((i + 1 > 2*limit) && (i + 1 <= 3*limit)) {
                result = Blockchain.transfer(address, perAward3);//wei
                if(!result) {
                    Event.Trigger("AwardTransferFailed", {
                        Transfer: {
                            from: Blockchain.transaction.to,
                            to: address,
                            value: perAward3
                        }
                    });
                    throw new Error("Award transfer failed. Walker Address:" + address + ", NAS(wei):" + perAward3);
                }  
                Event.Trigger("WinAwardTransfer", {
                    Transfer: {
                        from: Blockchain.transaction.to,
                        to: address,
                        value: perAward3
                    }
                });
                this.contractValue = this.contractValue - perAward3;
                var walker = new Walker();
                walker = this.walkerPool.get(parseInt(sortArray[i]));
                walker.award = perAward3;
                this.walkerPool.set(parseInt(sortArray[i]), walker);
            }
        }
        var record = new Record();
        record.totalNum = sortArray.length;
        record.totalAward = _totalAward;
        record.numOfAward = _count;

        this.awardRecord.put(_date,record);
        return 1;
    },
    //获得某一个日期的所有参与成员总数以及总奖励
    getTotalNumAndTotalAwardByDate: function(_date) {
        var record = this.awardRecord.get(_date);
        if(record != null) {
            return JSON.stringify(record);
        } else {
            //throw new Error("该日期奖励还没有发放");
            return 0;
        }
    },

    getMap:function(_date) {
        return this.historyDayWalker.get(_date);
    },
    getSort:function(_date) {
        return this.sortDayWalker.get(_date);
    },
    getWalker:function(_num) {
        return this.walkerPool.get(_num);
    },
    //获取某一天所有参与人的编号序列,存在historyDayWalker中
    //没有返回值
    _getHistoryWalkerChainFromDate:function(_date) {
        var result="";
        if(this.walkChainNumber == 0) {
            throw new Error("No walkers");
        }
        var ChainNum;
        for(var i = 0; i< this.walkChainNumber; i++) {
            if(this.walkerChains.get(i) == _date) {
                ChainNum = i;
                break;
            }
        }
        if(ChainNum == undefined) {
            throw new Error("Query date error, no such date.");
        }
        //判断该日期的编号字符串是否记录了在  historyDayWalker  中
        //判断日期是否是今天，如果是今天就从今天开始索引到totalWalkerNumber
        if(ChainNum == (this.walkChainNumber - 1)) {
            for(var i = this.walkerChainStartIndex.get(ChainNum); i < this.totalWalkerNumber; i++) {
                result = result + i + ",";
            }
            if(result != this.historyDayWalker.get(_date)) {
                this.historyDayWalker.put(_date, result);
            }
        } else {//如果不是今天，则从日期当天的开始索引遍历到下一天的开始索引为止
            if(this.historyDayWalker.get(_date) == null) {
                for(var i = this.walkerChainStartIndex.get(ChainNum); i < this.walkerChainStartIndex.get(ChainNum+1); i++){
                    result = result + i +",";
                }
                this.historyDayWalker.put(_date, result);
            }
        }
        //return this.historyDayWalker.get(_date);
    },
    //根据日期获得排序后的序列存入到  sortDayWalker中
    _getSortWalkerChainFromDate:function(_date) {

        var numStr = this.historyDayWalker.get(_date);
        numStr = numStr.substring(0, numStr.length - 1);  
        var strArray = numStr.split(",");
        var that = this;
        strArray.sort(function(a, b){
            return that.walkerPool.get(parseInt(b)).steps - that.walkerPool.get(parseInt(a)).steps;

        })
        var sortString = strArray.toString();
        this.sortDayWalker.put(_date, sortString); 
        //return this.sortDayWalker.get(_date);
    },
    //获取当前系统的日期时间，格式为"yyyy-MM-dd HH:MM:SS"
    _getCurrentTime: function() {
        var now = new Date();
        now.setHours(now.getHours()+8);

        var year = now.getFullYear();       //年
        var month = now.getMonth() + 1;     //月
        var day = now.getDate();            //日

        var hh = now.getHours();            //时
        var mm = now.getMinutes();          //分
        var ss = now.getSeconds();           //秒

        var clock = year + "-";

        if(month < 10)
            clock += "0";

        clock += month + "-";

        if(day < 10)
            clock += "0";

        clock += day + " ";

        if(hh < 10)
            clock += "0";

        clock += hh + ":";
        if (mm < 10) clock += '0';
        clock += mm + ":";

        if (ss < 10) clock += '0';
        clock += ss;
        return(clock);
   },
    //返回当前日期的日"yyyy-MM-dd"
    _getDateCurrentTime:function(_dateStr) {
       var str = _dateStr.substring(0,10);
        return str;
   }
};
module.exports = CompeteWalkStepContract;

//n1sgrhprVy8sQoVj8vkR3Dt2BXbwcDXqT2m
//n1f1o7nAhV2htNcAvTjRGtk7xyuFUjRg2Dq
//n1uBh1ddjxajj17ie7A3AK9bxEGyVe1M34y
//当天测试通过合约地址n1jqFVfNMYTgBamh2Ls9jShFvLkuNRcexCk
//n1ohPa1TwfzYuRjkwwm4GtpJmpP23m6mU3C
n1nY3JzbnxNV9WDL2uku3GUwZP4kA6911jJ
[3,100000000000000000,"2018-06-05"]
